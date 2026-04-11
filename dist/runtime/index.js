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
        checks: {},
        facts: {},
        decisions: {},
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
    ensureNonEmptyStringState(state.id, 'id');
    ensureNonEmptyStringState(state.version, 'version');
    ensureTraceMode(state.traceMode);
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
    if (state.id !== flow.id) {
        throw new XRuntimeError('FLOW_FLOW_MISMATCH', 'state.id does not belong to preparedFlow.id', {
            stateId: state.id,
            flowId: flow.id,
        });
    }
    if (state.version !== flow.version) {
        throw new XRuntimeError('FLOW_FLOW_MISMATCH', 'state.version does not match preparedFlow.version', {
            stateVersion: state.version,
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
        return {
            stepId: step.id,
            type: 'TERMINAL',
            subtype: step.subtype,
            result: structuredClone(step.result),
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
        subtype: step.subtype,
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
        const routeValue = getPath(state, step.factRef);
        if (!routeValue.found) {
            throw new XRuntimeError('FLOW_PATH_NOT_RESOLVED', `Path is not resolved: ${step.factRef}`, {
                path: step.factRef,
                stepId: step.id,
            });
        }
        const caseKey = normalizeRoutingValue(routeValue.value, `factRef(${step.factRef})`);
        return step.cases[caseKey] ?? step.defaultNextStepId;
    }
    if (step.subtype === 'SWITCH') {
        const decisions = isRecord(state.context.decisions) ? state.context.decisions : undefined;
        const decisionRecord = decisions?.[step.decisionSetId];
        if (!isRecord(decisionRecord)) {
            throw new XRuntimeError('FLOW_DECISION_NOT_RESOLVED', 'Decision set is not resolved in context.decisions', {
                decisionSetId: step.decisionSetId,
                stepId: step.id,
            });
        }
        const outcome = decisionRecord.outcome;
        if (!isNonEmptyString(outcome)) {
            throw new XRuntimeError('FLOW_DECISION_NOT_RESOLVED', 'Decision outcome is missing', {
                decisionSetId: step.decisionSetId,
                stepId: step.id,
            });
        }
        return step.cases[outcome] ?? step.defaultNextStepId;
    }
    // unreachable — CONTROL only has ROUTE and SWITCH subtypes
    throw new XRuntimeError('FLOW_REDUCE_INVALID_TYPE', 'Unknown CONTROL subtype', {});
}
function assignOutput(state, outputRef, output) {
    ensureJsonSafeValue(output, outputRef);
    const patchedState = setPath(state, outputRef, output);
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
        state.status = target.result.status;
        state.result = structuredClone(target.result);
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
    const flow = asPreparedFlowInternal(params.flow);
    const entryStep = ensurePreparedStep(flow, flow.entryStepId);
    const createdAt = now();
    const traceMode = params.trace ?? 'off';
    const state = {
        processId: ensureNonEmptyStringState(params.processId, 'processId'),
        id: ensureNonEmptyStringState(flow.id, 'flow.id'),
        version: ensureNonEmptyStringState(flow.version, 'flow.version'),
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
        state.status = entryStep.result.status;
        state.result = structuredClone(entryStep.result);
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
    const preparedFlow = asPreparedFlowInternal(flow);
    const currentStep = ensureRuntimeAllowed(preparedFlow, state);
    if (currentStep.type === 'PROCESS') {
        const executableStep = currentStep;
        const next = buildTransitionTarget(preparedFlow, executableStep.nextStepId);
        const normalized = {
            id: executableStep.id,
            type: 'PROCESS',
            subtype: executableStep.subtype,
            artefactId: executableStep.artefactId,
            input: resolveInput(state, executableStep.contract.input.ref),
            outputRef: executableStep.contract.output.ref,
            next,
        };
        return normalized;
    }
    if (currentStep.type === 'CONTROL') {
        const selectedNextStepId = resolveSelectedNextStepId(preparedFlow, currentStep, state);
        const next = buildTransitionTarget(preparedFlow, selectedNextStepId);
        if (currentStep.subtype === 'ROUTE') {
            const normalized = {
                id: currentStep.id,
                type: 'CONTROL',
                subtype: 'ROUTE',
                selectedNextStepId,
                next,
            };
            return normalized;
        }
        const normalized = {
            id: currentStep.id,
            type: 'CONTROL',
            subtype: 'SWITCH',
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
    return {
        id: currentStep.id,
        type: 'TERMINAL',
        subtype: currentStep.subtype,
        result: structuredClone(currentStep.result),
    };
}
export function reduce(step, currentState, output) {
    if (currentState.status === 'COMPLETE' || currentState.status === 'FAIL') {
        throw new XRuntimeError('FLOW_TERMINAL_MISUSED', 'reduce(...) cannot be called on terminal process', {
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
    if (step.subtype === 'RULES' || step.subtype === 'MAPPINGS' || step.subtype === 'DECISIONS') {
        const executableInternal = internalStep;
        if (!isNonEmptyString(executableInternal.outputRef)) {
            throw new XRuntimeError('FLOW_STATE_INVALID', 'Executable PROCESS step is missing contract.output.ref', {
                stepId: step.id,
            });
        }
        assignOutput(nextState, executableInternal.outputRef, output);
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
    const preparedFlow = asPreparedFlowInternal(flow);
    const currentStep = ensureRuntimeAllowed(preparedFlow, currentState);
    ensureCurrentStep(currentState, stepId, 'EFFECT', 'FLOW_APPLY_INVALID_TYPE');
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
    const preparedFlow = asPreparedFlowInternal(flow);
    const currentStep = ensureRuntimeAllowed(preparedFlow, currentState);
    ensureCurrentStep(currentState, stepId, 'WAIT', 'FLOW_RESUME_INVALID_TYPE');
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
