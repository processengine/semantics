import { asPreparedFlowInternal } from '../compiler/compiled.js';
import { XRuntimeError } from '../errors/index.js';
import { isNonEmptyString, isRecord } from '../utils/guards.js';
import { isJsonSafe } from '../utils/json.js';
import { getPath, resolveInput, setPath } from '../utils/path.js';
function now() {
    return new Date().toISOString();
}
function cloneState(state) {
    return structuredClone(state);
}
function buildContext(input) {
    return {
        input: structuredClone(input ?? {}),
        data: {
            payloads: {},
            facts: {},
            decisions: {},
            checks: {},
            results: {},
        },
        steps: {},
        effects: {},
    };
}
function ensureTraceMode(value) {
    if (value === 'off' || value === 'basic' || value === 'verbose')
        return value;
    throw new XRuntimeError('FLOW_STATE_INVALID', 'traceMode must be "off", "basic", or "verbose"', {
        traceMode: value,
    });
}
function ensureNonEmptyStringState(value, field, code = 'FLOW_STATE_INVALID') {
    if (!isNonEmptyString(value)) {
        throw new XRuntimeError(code, `${field} must be a non-empty string`, { field });
    }
    return value;
}
function ensureJsonObject(value, field) {
    if (value === undefined)
        return {};
    if (!isRecord(value) || !isJsonSafe(value)) {
        throw new XRuntimeError('FLOW_STATE_INVALID', `${field} must be a JSON-safe object`, { field });
    }
    return structuredClone(value);
}
function ensureRuntimeObject(value, method, field) {
    if (!isRecord(value)) {
        throw new XRuntimeError('FLOW_RUNTIME_INPUT_INVALID', `${method}: ${field} must be a non-null object`, { field });
    }
}
function ensurePreparedFlowInput(value, method) {
    ensureRuntimeObject(value, method, 'flow');
    const flow = asPreparedFlowInternal(value);
    if (!isNonEmptyString(flow.id) || !isNonEmptyString(flow.version) || !isNonEmptyString(flow.entryStepId) || !isRecord(flow.stepsById)) {
        throw new XRuntimeError('FLOW_RUNTIME_INPUT_INVALID', `${method}: flow must be a prepared flow object from prepareFlow()`, {});
    }
    return flow;
}
function ensureProcessStateInput(value, method) {
    ensureRuntimeObject(value, method, 'state');
}
function ensureStepIdInput(value, method) {
    if (!isNonEmptyString(value)) {
        throw new XRuntimeError('FLOW_RUNTIME_INPUT_INVALID', `${method}: stepId must be a non-empty string`, { stepId: value });
    }
    return value;
}
function ensureJsonSafeValue(value, field) {
    if (!isJsonSafe(value)) {
        throw new XRuntimeError('FLOW_RESULT_SHAPE_INVALID', `${field} must be JSON-safe`, { field });
    }
}
function appendHistory(state, entry) {
    if (state.traceMode === 'off')
        return;
    state.history.push(entry);
}
function updateStepTrace(state, stepId, patch) {
    if (state.traceMode === 'off')
        return;
    const existing = state.context.steps[stepId];
    const nextTrace = {
        status: patch.status,
        startedAt: patch.startedAt ?? existing?.startedAt ?? now(),
        finishedAt: patch.finishedAt,
        failureCode: patch.failureCode,
        reason: patch.reason,
    };
    if (patch.selectedNextStepId !== undefined)
        nextTrace.selectedNextStepId = patch.selectedNextStepId;
    else if (existing?.selectedNextStepId !== undefined)
        nextTrace.selectedNextStepId = existing.selectedNextStepId;
    if (patch.requestId !== undefined)
        nextTrace.requestId = patch.requestId;
    else if (existing?.requestId !== undefined)
        nextTrace.requestId = existing.requestId;
    state.context.steps[stepId] = nextTrace;
}
function ensurePreparedStep(flow, stepId) {
    const step = flow.stepsById[stepId];
    if (!step) {
        throw new XRuntimeError('FLOW_STEP_NOT_FOUND', `Step is not present in preparedFlow: ${stepId}`, { stepId });
    }
    return step;
}
function ensureStateMatchesFlow(flow, state) {
    ensureNonEmptyStringState(state.processId, 'processId');
    ensureNonEmptyStringState(state.flowId, 'flowId');
    ensureNonEmptyStringState(state.flowVersion, 'flowVersion');
    ensureTraceMode(state.traceMode);
    if (state.status !== 'ACTIVE' && state.status !== 'WAITING' && state.status !== 'COMPLETE' && state.status !== 'FAIL') {
        throw new XRuntimeError('FLOW_STATE_INVALID', 'status must be ACTIVE, WAITING, COMPLETE, or FAIL', { status: state.status });
    }
    ensureNonEmptyStringState(state.currentStepId, 'currentStepId');
    ensureNonEmptyStringState(state.currentStepType, 'currentStepType');
    ensureNonEmptyStringState(state.currentStepSubtype, 'currentStepSubtype');
    if (!isRecord(state.context)) {
        throw new XRuntimeError('FLOW_STATE_INVALID', 'context must be an object');
    }
    if (!Array.isArray(state.history) || !isJsonSafe(state.history)) {
        throw new XRuntimeError('FLOW_STATE_INVALID', 'history must be a JSON-safe array');
    }
    if (state.result !== null && (!isRecord(state.result) || !isJsonSafe(state.result))) {
        throw new XRuntimeError('FLOW_STATE_INVALID', 'result must be null or a JSON-safe object');
    }
    if (!isRecord(state.meta) || !isJsonSafe(state.meta)) {
        throw new XRuntimeError('FLOW_STATE_INVALID', 'meta must be a JSON-safe object');
    }
    const stateFlowId = state.flowId;
    const stateFlowVersion = state.flowVersion;
    if (stateFlowId !== flow.id) {
        throw new XRuntimeError('FLOW_FLOW_MISMATCH', 'state.flowId does not belong to preparedFlow.id', {
            stateFlowId,
            flowId: flow.id,
        });
    }
    if (stateFlowVersion !== flow.version) {
        throw new XRuntimeError('FLOW_FLOW_MISMATCH', 'state.flowVersion does not match preparedFlow.version', {
            stateFlowVersion,
            flowVersion: flow.version,
        });
    }
    const currentStep = ensurePreparedStep(flow, state.currentStepId);
    if (currentStep.type !== state.currentStepType || currentStep.subtype !== state.currentStepSubtype) {
        throw new XRuntimeError('FLOW_STEP_MISMATCH', 'Current step metadata is inconsistent with preparedFlow', {
            currentStepId: state.currentStepId,
            currentStepType: state.currentStepType,
            currentStepSubtype: state.currentStepSubtype,
        });
    }
    if (state.status === 'WAITING' && currentStep.type !== 'WAIT') {
        throw new XRuntimeError('FLOW_STEP_MISMATCH', 'WAITING state must point to WAIT step', {
            currentStepId: state.currentStepId,
            status: state.status,
        });
    }
    if ((state.status === 'COMPLETE' || state.status === 'FAIL') && currentStep.type !== 'TERMINAL') {
        throw new XRuntimeError('FLOW_STEP_MISMATCH', 'Terminal state must point to TERMINAL step', {
            currentStepId: state.currentStepId,
            status: state.status,
        });
    }
    return currentStep;
}
function ensureRuntimeAllowed(flow, state) {
    const currentStep = ensureStateMatchesFlow(flow, state);
    if (state.status === 'COMPLETE' || state.status === 'FAIL') {
        throw new XRuntimeError('FLOW_TERMINAL_MISUSED', 'Runtime methods cannot be called on terminal process', {
            status: state.status,
            stepId: state.currentStepId,
        });
    }
    return currentStep;
}
function buildTransitionTarget(flow, stepId) {
    const step = ensurePreparedStep(flow, stepId);
    if (step.type === 'TERMINAL') {
        const terminalStep = step;
        if (terminalStep.resultRef) {
            return {
                stepId: step.id,
                type: 'TERMINAL',
                subtype: step.subtype,
                resultRef: terminalStep.resultRef,
            };
        }
        return {
            stepId: step.id,
            type: 'TERMINAL',
            subtype: step.subtype,
            result: structuredClone(terminalStep.result),
        };
    }
    if (step.type === 'WAIT') {
        return {
            stepId: step.id,
            type: 'WAIT',
            subtype: step.subtype,
            sourceStepId: step.sourceStepId,
        };
    }
    if (step.type === 'EFFECT') {
        return {
            stepId: step.id,
            type: 'EFFECT',
            subtype: step.subtype,
        };
    }
    if (step.type === 'CONTROL') {
        return {
            stepId: step.id,
            type: 'CONTROL',
            subtype: step.subtype,
        };
    }
    return {
        stepId: step.id,
        type: 'PROCESS',
        subtype: 'DATA',
    };
}
function normalizeRoutingValue(value, field) {
    if (value === null)
        return 'null';
    if (typeof value === 'string')
        return value;
    if (typeof value === 'number' || typeof value === 'boolean')
        return String(value);
    throw new XRuntimeError('FLOW_ROUTING_VALUE_INVALID', `${field} must resolve to scalar value`, { field });
}
function resolveSelectedNextStepId(flow, step, state) {
    if (step.subtype === 'ROUTE') {
        const routeRef = step['ref'];
        const routeValue = getPath(state, routeRef);
        if (!routeValue.found) {
            // Missing ref is a broken dataflow contract — not a business "no match"
            throw new XRuntimeError('FLOW_ROUTE_REF_NOT_RESOLVED', `CONTROL/ROUTE ref not found in state: ${routeRef}`, {
                ref: routeRef, stepId: step.id,
            });
        }
        const val = routeValue.value;
        if (val !== null && typeof val === 'object') {
            throw new XRuntimeError('FLOW_ROUTE_REF_NOT_SCALAR', `CONTROL/ROUTE ref must resolve to a scalar value, got object/array: ${routeRef}`, {
                ref: routeRef,
                stepId: step.id,
            });
        }
        const caseKey = normalizeRoutingValue(val, `ref(${routeRef})`);
        return step.cases[caseKey] ?? step.defaultNextStepId;
    }
    // unreachable in Flow 5 — CONTROL only has ROUTE
    throw new XRuntimeError('FLOW_REDUCE_INVALID_TYPE', 'Unknown CONTROL subtype', {});
}
function assignOutput(state, outputRef, output) {
    ensureJsonSafeValue(output, outputRef);
    const patchedState = setPath(state, outputRef, output);
    state.context = patchedState.context;
}
function assertValidDataflowWrite(write, stepId) {
    if (!isRecord(write)) {
        throw new XRuntimeError('FLOW_DATA_WRITE_INVALID', 'DataflowOutput write must be an object', { stepId });
    }
    const w = write;
    if (!isNonEmptyString(w['ref'])) {
        throw new XRuntimeError('FLOW_DATA_WRITE_INVALID', 'DataflowOutput write.ref must be a non-empty string', { stepId });
    }
    if (!isNonEmptyString(w['itemId'])) {
        throw new XRuntimeError('FLOW_DATA_WRITE_INVALID', 'DataflowOutput write.itemId must be a non-empty string', { stepId });
    }
    const ref = w['ref'];
    if (!ref.startsWith('$.context.data.')) {
        throw new XRuntimeError('FLOW_DATA_WRITE_FORBIDDEN_PATH', `DataflowOutput write.ref must start with "$.context.data.": ${ref}`, { stepId, ref });
    }
    if (!isJsonSafe(w['value'])) {
        throw new XRuntimeError('FLOW_DATA_WRITE_NOT_JSON_SAFE', `DataflowOutput write.value must be JSON-safe for ref: ${ref}`, { stepId, ref });
    }
}
function applyDataflowWrite(state, write) {
    const patchedState = setPath(state, write.ref, write.value);
    state.context = patchedState.context;
}
function followTransition(state, target, at) {
    if (target.type === 'WAIT') {
        state.status = 'WAITING';
        state.currentStepId = target.stepId;
        state.currentStepType = 'WAIT';
        state.currentStepSubtype = target.subtype;
        updateStepTrace(state, target.stepId, {
            status: 'WAITING',
            startedAt: at,
            finishedAt: null,
            failureCode: null,
            reason: null,
        });
        appendHistory(state, { at, kind: 'STEP_WAITING', stepId: target.stepId });
        return state;
    }
    if (target.type === 'TERMINAL') {
        let result;
        if (target.resultRef) {
            const resolved = getPath(state, target.resultRef);
            if (!resolved.found || !isRecord(resolved.value) || !isJsonSafe(resolved.value)) {
                throw new XRuntimeError('FLOW_RESULT_REF_NOT_RESOLVED', `TERMINAL resultRef path is missing or not a JSON-safe object: ${target.resultRef}`, { resultRef: target.resultRef, stepId: target.stepId });
            }
            const dynamic = resolved.value;
            if (!isNonEmptyString(dynamic['outcome'])) {
                throw new XRuntimeError('FLOW_RESULT_REF_SHAPE_INVALID', `Value at resultRef must have a non-empty string "outcome": ${target.resultRef}`, { resultRef: target.resultRef, stepId: target.stepId });
            }
            if (dynamic['status'] !== target.subtype) {
                throw new XRuntimeError('FLOW_RESULT_REF_SHAPE_INVALID', `Value at resultRef "status" must match TERMINAL subtype "${target.subtype}": ${target.resultRef}`, { resultRef: target.resultRef, stepId: target.stepId, status: dynamic['status'] });
            }
            result = structuredClone(dynamic);
        }
        else {
            result = structuredClone(target.result);
        }
        state.status = result.status;
        state.result = result;
        state.currentStepId = target.stepId;
        state.currentStepType = 'TERMINAL';
        state.currentStepSubtype = target.subtype;
        updateStepTrace(state, target.stepId, {
            status: 'COMPLETED',
            startedAt: at,
            finishedAt: at,
            failureCode: null,
            reason: null,
        });
        appendHistory(state, { at, kind: 'STEP_COMPLETED', stepId: target.stepId });
        return state;
    }
    state.status = 'ACTIVE';
    state.currentStepId = target.stepId;
    state.currentStepType = target.type;
    state.currentStepSubtype = target.subtype;
    return state;
}
function ensureCurrentStep(state, expectedId, expectedType, invalidTypeCode) {
    if (state.currentStepId !== expectedId) {
        throw new XRuntimeError('FLOW_STEP_ID_MISMATCH', 'stepId does not match currentStepId', {
            stepId: expectedId,
            currentStepId: state.currentStepId,
        });
    }
    if (state.currentStepType !== expectedType) {
        throw new XRuntimeError(invalidTypeCode, `Current step must be ${expectedType}`, {
            stepId: expectedId,
            currentStepType: state.currentStepType,
        });
    }
}
function chooseFailureTarget(flow, stepId, nextIds, errorCode) {
    if (errorCode === 'TIMEOUT') {
        if (!isNonEmptyString(nextIds.onTimeoutStepId)) {
            throw new XRuntimeError('FLOW_STATE_INVALID', 'Timeout result does not have onTimeoutStepId transition', { stepId });
        }
        return buildTransitionTarget(flow, nextIds.onTimeoutStepId);
    }
    if (!isNonEmptyString(nextIds.onErrorStepId)) {
        throw new XRuntimeError('FLOW_STATE_INVALID', 'Error result does not have onErrorStepId transition', { stepId });
    }
    return buildTransitionTarget(flow, nextIds.onErrorStepId);
}
function normalizeExternalResult(result, field) {
    if (!isRecord(result)) {
        throw new XRuntimeError('FLOW_RUNTIME_INPUT_INVALID', `${field} must be a JSON-safe object`, { field });
    }
    const requestId = ensureNonEmptyStringState(result.requestId, `${field}.requestId`, 'FLOW_REQUEST_ID_MISSING');
    if (result.result !== undefined && result.result !== null)
        ensureJsonSafeValue(result.result, `${field}.result`);
    if (result.error !== undefined && result.error !== null)
        ensureJsonSafeValue(result.error, `${field}.error`);
    if (result.errorCode !== undefined && result.errorCode !== null && !isNonEmptyString(result.errorCode)) {
        throw new XRuntimeError('FLOW_RESULT_SHAPE_INVALID', `${field}.errorCode must be a non-empty string or null`);
    }
    if (result.result !== undefined && result.result !== null && result.error !== undefined && result.error !== null) {
        throw new XRuntimeError('FLOW_MIXED_RESULT', `${field} cannot contain both result and error`, { field });
    }
    return {
        requestId,
        result: result.result ?? null,
        error: result.error ?? null,
        errorCode: result.errorCode ?? null,
    };
}
function reasonFromError(error) {
    if (error === null || error === undefined)
        return null;
    if (typeof error === 'string')
        return error;
    if (isJsonSafe(error))
        return JSON.stringify(error);
    return 'External error';
}
export function createProcessState(params) {
    if (params == null || typeof params !== 'object') {
        throw new XRuntimeError('FLOW_RUNTIME_INPUT_INVALID', 'createProcessState: params must be a non-null object', { received: typeof params });
    }
    const flow = ensurePreparedFlowInput(params.flow, 'createProcessState');
    if (typeof params.processId !== 'string' || params.processId.trim() === '') {
        throw new XRuntimeError('FLOW_RUNTIME_INPUT_INVALID', 'createProcessState: params.processId must be a non-empty string', {});
    }
    const entryStep = ensurePreparedStep(flow, flow.entryStepId);
    const createdAt = now();
    const traceMode = params.trace ?? 'off';
    const state = {
        processId: ensureNonEmptyStringState(params.processId, 'processId'),
        flowId: ensureNonEmptyStringState(flow.id, 'flow.id'),
        flowVersion: ensureNonEmptyStringState(flow.version, 'flow.version'),
        traceMode,
        status: 'ACTIVE',
        currentStepId: entryStep.id,
        currentStepType: entryStep.type,
        currentStepSubtype: entryStep.subtype,
        context: buildContext(ensureJsonObject(params.input, 'input')),
        history: [],
        result: null,
        meta: ensureJsonObject(params.meta, 'meta'),
    };
    if (entryStep.type === 'WAIT') {
        state.status = 'WAITING';
        updateStepTrace(state, entryStep.id, {
            status: 'WAITING',
            startedAt: createdAt,
            finishedAt: null,
            failureCode: null,
            reason: null,
        });
        appendHistory(state, { at: createdAt, kind: 'STEP_WAITING', stepId: entryStep.id });
    }
    if (entryStep.type === 'TERMINAL') {
        const terminalEntry = entryStep;
        let entryResult;
        if (terminalEntry.resultRef) {
            // resultRef at entry is forbidden by validateFlow.
            // If somehow reached (e.g. prepareFlow used without validateFlow),
            // fail clearly rather than silently using empty context.
            throw new XRuntimeError('FLOW_RESULT_REF_NOT_RESOLVED', 'TERMINAL with resultRef cannot be the entryStepId: dynamic terminal result must be produced by a prior process step', { stepId: entryStep.id, resultRef: terminalEntry.resultRef });
        }
        else {
            entryResult = structuredClone(terminalEntry.result);
        }
        state.status = entryResult.status;
        state.result = entryResult;
        updateStepTrace(state, entryStep.id, {
            status: 'COMPLETED',
            startedAt: createdAt,
            finishedAt: createdAt,
            failureCode: null,
            reason: null,
        });
        appendHistory(state, { at: createdAt, kind: 'STEP_COMPLETED', stepId: entryStep.id });
    }
    return state;
}
export function plan(flow, state) {
    const preparedFlow = ensurePreparedFlowInput(flow, 'plan');
    ensureProcessStateInput(state, 'plan');
    const currentStep = ensureRuntimeAllowed(preparedFlow, state);
    if (currentStep.type === 'PROCESS') {
        const dataStep = currentStep;
        const next = buildTransitionTarget(preparedFlow, dataStep.nextStepId);
        const normalized = {
            id: dataStep.id,
            type: 'PROCESS',
            subtype: 'DATA',
            artefactId: dataStep.artefactId,
            nextStepId: dataStep.nextStepId,
            next,
        };
        return normalized;
    }
    if (currentStep.type === 'CONTROL') {
        const selectedNextStepId = resolveSelectedNextStepId(preparedFlow, currentStep, state);
        const next = buildTransitionTarget(preparedFlow, selectedNextStepId);
        const normalized = {
            id: currentStep.id,
            type: 'CONTROL',
            subtype: 'ROUTE',
            selectedNextStepId,
            next,
        };
        return normalized;
    }
    if (currentStep.type === 'EFFECT') {
        const effectStep = currentStep;
        const normalized = {
            id: effectStep.id,
            type: 'EFFECT',
            subtype: effectStep.subtype,
            operationId: effectStep.operationId,
            input: resolveInput(state, effectStep.inputRef),
        };
        if (effectStep.subtype === 'SUBFLOW') {
            const subflowStep = effectStep;
            normalized.flowId = subflowStep.flowId;
            normalized.flowVersion = subflowStep.flowVersion;
        }
        return normalized;
    }
    if (currentStep.type === 'WAIT') {
        const waitStep = currentStep;
        const effectRecord = isRecord(state.context.effects[waitStep.sourceStepId])
            ? state.context.effects[waitStep.sourceStepId]
            : null;
        const requestId = isNonEmptyString(effectRecord?.requestId) ? effectRecord.requestId : undefined;
        const sourceEffectStep = preparedFlow.stepsById[waitStep.sourceStepId];
        const operationId = isNonEmptyString(sourceEffectStep?.operationId) ? sourceEffectStep.operationId : undefined;
        const normalized = {
            id: waitStep.id,
            type: 'WAIT',
            subtype: 'MESSAGE',
            sourceStepId: waitStep.sourceStepId,
        };
        if (requestId !== undefined)
            normalized.requestId = requestId;
        if (operationId !== undefined)
            normalized.operationId = operationId;
        return normalized;
    }
    const terminalPlan = currentStep;
    if (terminalPlan.resultRef) {
        return {
            id: terminalPlan.id,
            type: 'TERMINAL',
            subtype: terminalPlan.subtype,
            resultRef: terminalPlan.resultRef,
        };
    }
    return {
        id: terminalPlan.id,
        type: 'TERMINAL',
        subtype: terminalPlan.subtype,
        result: structuredClone(terminalPlan.result),
    };
}
export function reduce(step, currentState, output) {
    if (step == null || typeof step !== 'object' || typeof step.id !== 'string') {
        throw new XRuntimeError('FLOW_RUNTIME_INPUT_INVALID', 'reduce: step must be a normalized step object from plan()', {});
    }
    if (currentState == null || typeof currentState !== 'object') {
        throw new XRuntimeError('FLOW_RUNTIME_INPUT_INVALID', 'reduce: state must be a ProcessState object', {});
    }
    // TERMINAL: resolves static result or resultRef and finalizes state.
    if (step.type === 'TERMINAL') {
        if (currentState.currentStepId !== step.id) {
            throw new XRuntimeError('FLOW_STEP_MISMATCH', 'reduce(TERMINAL) step does not match current state', {
                stepId: step.id, currentStepId: currentState.currentStepId,
            });
        }
        if (currentState.currentStepType !== 'TERMINAL' || currentState.currentStepSubtype !== step.subtype) {
            throw new XRuntimeError('FLOW_REDUCE_INVALID_TYPE', 'Current step must be TERMINAL', {
                stepId: step.id, currentStepType: currentState.currentStepType, currentStepSubtype: currentState.currentStepSubtype,
            });
        }
        if (currentState.status === 'COMPLETE' || currentState.status === 'FAIL') {
            return currentState;
        }
        const terminalStep = step;
        const target = terminalStep.resultRef
            ? { stepId: step.id, type: 'TERMINAL', subtype: step.subtype, resultRef: terminalStep.resultRef }
            : { stepId: step.id, type: 'TERMINAL', subtype: step.subtype, result: structuredClone(terminalStep.result) };
        return followTransition(cloneState(currentState), target, now());
    }
    if (currentState.status === 'COMPLETE' || currentState.status === 'FAIL') {
        throw new XRuntimeError('FLOW_TERMINAL_MISUSED', 'reduce(...) cannot be called on an already-terminal process', {
            status: currentState.status,
        });
    }
    const expectedStepType = (step.type === 'CONTROL' ? 'CONTROL' : 'PROCESS');
    ensureCurrentStep(currentState, step.id, expectedStepType, 'FLOW_REDUCE_INVALID_TYPE');
    if (currentState.currentStepSubtype !== step.subtype) {
        throw new XRuntimeError('FLOW_STEP_MISMATCH', 'Step subtype does not match current state', {
            stepId: step.id,
            currentStepSubtype: currentState.currentStepSubtype,
            stepSubtype: step.subtype,
        });
    }
    const internalStep = step;
    if (!('next' in internalStep) || !isRecord(internalStep.next) || !isNonEmptyString(internalStep.next.stepId)) {
        throw new XRuntimeError('FLOW_STATE_INVALID', 'reduce(...) requires a normalized PROCESS step returned by plan(...)', {
            stepId: step.id,
        });
    }
    const nextState = cloneState(currentState);
    const at = now();
    if (step.type === 'PROCESS' && step.subtype === 'DATA') {
        // output must be DataflowOutput { writes: DataflowWrite[] }
        if (!isRecord(output) || !Array.isArray(output['writes'])) {
            throw new XRuntimeError('FLOW_DATA_OUTPUT_INVALID', 'reduce(PROCESS/DATA) requires DataflowOutput with writes array', {
                stepId: step.id,
            });
        }
        const dataOutput = output;
        // Validate trace if present — must be JSON-safe array (transport-safe contract)
        if (dataOutput.trace !== undefined) {
            if (!Array.isArray(dataOutput.trace) || !isJsonSafe(dataOutput.trace)) {
                throw new XRuntimeError('FLOW_DATA_OUTPUT_INVALID', 'DataflowOutput.trace must be a JSON-safe array or absent', { stepId: step.id });
            }
        }
        for (const write of dataOutput.writes) {
            assertValidDataflowWrite(write, step.id);
            applyDataflowWrite(nextState, write);
        }
    }
    updateStepTrace(nextState, step.id, {
        status: 'COMPLETED',
        startedAt: at,
        finishedAt: at,
        failureCode: null,
        reason: null,
        selectedNextStepId: internalStep.next.stepId,
    });
    appendHistory(nextState, {
        at,
        kind: 'STEP_COMPLETED',
        stepId: step.id,
        details: { selectedNextStepId: internalStep.next.stepId },
    });
    return followTransition(nextState, internalStep.next, at);
}
export function apply(flow, currentState, stepId, effectResult) {
    const preparedFlow = ensurePreparedFlowInput(flow, 'apply');
    ensureProcessStateInput(currentState, 'apply');
    const normalizedStepId = ensureStepIdInput(stepId, 'apply');
    const currentStep = ensureRuntimeAllowed(preparedFlow, currentState);
    ensureCurrentStep(currentState, normalizedStepId, 'EFFECT', 'FLOW_APPLY_INVALID_TYPE');
    if (currentStep.type !== 'EFFECT') {
        throw new XRuntimeError('FLOW_APPLY_INVALID_TYPE', 'apply(...) can be used only for EFFECT step', { stepId });
    }
    const normalizedResult = normalizeExternalResult(effectResult, 'effectResult');
    const nextState = cloneState(currentState);
    const at = now();
    const failed = normalizedResult.error !== null;
    const target = failed
        ? chooseFailureTarget(preparedFlow, currentStep.id, currentStep, normalizedResult.errorCode)
        : buildTransitionTarget(preparedFlow, currentStep.nextStepId);
    nextState.context.effects[currentStep.id] = {
        requestId: normalizedResult.requestId,
        result: normalizedResult.result,
        error: normalizedResult.error,
        errorCode: normalizedResult.errorCode,
    };
    updateStepTrace(nextState, currentStep.id, {
        status: failed ? 'FAILED' : 'COMPLETED',
        startedAt: at,
        finishedAt: at,
        failureCode: failed ? normalizedResult.errorCode ?? 'ERROR' : null,
        reason: failed ? reasonFromError(normalizedResult.error) : null,
        requestId: normalizedResult.requestId,
        selectedNextStepId: target.stepId,
    });
    appendHistory(nextState, {
        at,
        kind: failed ? 'STEP_FAILED' : 'STEP_COMPLETED',
        stepId: currentStep.id,
        details: { requestId: normalizedResult.requestId, selectedNextStepId: target.stepId },
    });
    return followTransition(nextState, target, at);
}
export function resume(flow, currentState, stepId, waitResult) {
    const preparedFlow = ensurePreparedFlowInput(flow, 'resume');
    ensureProcessStateInput(currentState, 'resume');
    const normalizedStepId = ensureStepIdInput(stepId, 'resume');
    const currentStep = ensureRuntimeAllowed(preparedFlow, currentState);
    ensureCurrentStep(currentState, normalizedStepId, 'WAIT', 'FLOW_RESUME_INVALID_TYPE');
    if (currentStep.type !== 'WAIT') {
        throw new XRuntimeError('FLOW_RESUME_INVALID_TYPE', 'resume(...) can be used only for WAIT step', { stepId });
    }
    const normalizedResult = normalizeExternalResult(waitResult, 'waitResult');
    const nextState = cloneState(currentState);
    const at = now();
    const failed = normalizedResult.error !== null;
    const target = failed
        ? chooseFailureTarget(preparedFlow, currentStep.id, currentStep, normalizedResult.errorCode)
        : buildTransitionTarget(preparedFlow, currentStep.nextStepId);
    const effectRecord = isRecord(nextState.context.effects[currentStep.sourceStepId])
        ? structuredClone(nextState.context.effects[currentStep.sourceStepId])
        : {};
    effectRecord.waitResult = {
        requestId: normalizedResult.requestId,
        result: normalizedResult.result,
        error: normalizedResult.error,
        errorCode: normalizedResult.errorCode,
    };
    nextState.context.effects[currentStep.sourceStepId] = effectRecord;
    updateStepTrace(nextState, currentStep.id, {
        status: failed ? 'FAILED' : 'COMPLETED',
        finishedAt: at,
        failureCode: failed ? normalizedResult.errorCode ?? 'ERROR' : null,
        reason: failed ? reasonFromError(normalizedResult.error) : null,
        requestId: normalizedResult.requestId,
        selectedNextStepId: target.stepId,
    });
    appendHistory(nextState, {
        at,
        kind: 'STEP_RESUMED',
        stepId: currentStep.id,
        details: { requestId: normalizedResult.requestId, selectedNextStepId: target.stepId },
    });
    return followTransition(nextState, target, at);
}
