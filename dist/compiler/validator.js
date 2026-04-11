import { createPreparedFlow } from './compiled.js';
import { XCompileError } from '../errors/index.js';
import { isNonEmptyString, isRecord } from '../utils/guards.js';
import { isJsonSafe } from '../utils/json.js';
import { isPathObject, isValidPath, isWritablePath } from '../utils/path.js';
const STEP_TYPES = new Set(['PROCESS', 'CONTROL', 'EFFECT', 'WAIT', 'TERMINAL']);
const PROCESS_EXEC_SUBTYPES = new Set(['RULES', 'MAPPINGS', 'DECISIONS']);
const PROCESS_ROUTING_SUBTYPES = new Set(['ROUTE', 'SWITCH']);
const EFFECT_SUBTYPES = new Set(['COMMAND', 'CALL', 'SUBFLOW']);
const WAIT_SUBTYPES = new Set(['MESSAGE']);
const TERMINAL_SUBTYPES = new Set(['COMPLETE', 'FAIL']);
const EXECUTABLE_PROCESS_ALLOWED_FIELDS = new Set([
    'id',
    'type',
    'subtype',
    'artefactId',
    'contract',
    'nextStepId',
    'title',
    'description',
    'metadata',
]);
const ROUTE_ALLOWED_FIELDS = new Set([
    'id',
    'type',
    'subtype',
    'factRef',
    'cases',
    'defaultNextStepId',
    'title',
    'description',
    'metadata',
]);
const SWITCH_ALLOWED_FIELDS = new Set([
    'id',
    'type',
    'subtype',
    'decisionSetId',
    'cases',
    'defaultNextStepId',
    'title',
    'description',
    'metadata',
]);
const EFFECT_ALLOWED_FIELDS = new Set([
    'id',
    'type',
    'subtype',
    'operationId',
    'inputRef',
    'nextStepId',
    'onErrorStepId',
    'onTimeoutStepId',
    'title',
    'description',
    'metadata',
]);
const SUBFLOW_EFFECT_ALLOWED_FIELDS = new Set([
    'id',
    'type',
    'subtype',
    'operationId',
    'flowId',
    'flowVersion',
    'inputRef',
    'nextStepId',
    'onErrorStepId',
    'onTimeoutStepId',
    'title',
    'description',
    'metadata',
]);
const WAIT_ALLOWED_FIELDS = new Set([
    'id',
    'type',
    'subtype',
    'sourceStepId',
    'nextStepId',
    'onErrorStepId',
    'onTimeoutStepId',
    'title',
    'description',
    'metadata',
]);
const TERMINAL_ALLOWED_FIELDS = new Set([
    'id',
    'type',
    'subtype',
    'result',
    'title',
    'description',
    'metadata',
]);
function rootPath(field) {
    return `$.${field}`;
}
function stepPath(stepKey, field) {
    const prefix = `$.steps[${JSON.stringify(stepKey)}]`;
    return field ? `${prefix}.${field}` : prefix;
}
function issue(code, message, path, details) {
    const result = { code, message };
    if (path !== undefined)
        result.path = path;
    if (details !== undefined)
        result.details = details;
    return result;
}
function pushRequiredString(errors, value, path, field, code = 'FLOW_REQUIRED_FIELD_MISSING') {
    if (!isNonEmptyString(value)) {
        errors.push(issue(code, `${field} is required`, path));
        return false;
    }
    return true;
}
function validateAllowedFields(stepKey, rawStep, allowed, errors) {
    for (const key of Object.keys(rawStep)) {
        if (!allowed.has(key)) {
            errors.push(issue('FLOW_FIELD_FORBIDDEN', `Field is forbidden for this step: ${key}`, stepPath(stepKey, key)));
        }
    }
}
function validateReadRef(errors, value, path) {
    if (typeof value === 'string') {
        if (!isValidPath(value)) {
            errors.push(issue('FLOW_PATH_SYNTAX_INVALID', `Invalid path syntax: ${value}`, path));
        }
        return;
    }
    if (!isPathObject(value)) {
        errors.push(issue('FLOW_PATH_SYNTAX_INVALID', 'contract.input.ref or EFFECT inputRef must be a path string or object of paths', path));
        return;
    }
    for (const [key, nested] of Object.entries(value)) {
        validateReadRef(errors, nested, `${path}.${key}`);
    }
}
function validateWriteRef(errors, value, path, expectedPrefix) {
    if (!isNonEmptyString(value)) {
        errors.push(issue('FLOW_REQUIRED_FIELD_MISSING', 'contract.output.ref is required', path));
        return;
    }
    if (!isValidPath(value)) {
        errors.push(issue('FLOW_PATH_SYNTAX_INVALID', `Invalid path syntax: ${value}`, path));
        return;
    }
    if (!isWritablePath(value)) {
        errors.push(issue('FLOW_WRITE_NAMESPACE_FORBIDDEN', `Write path is forbidden: ${value}`, path));
        return;
    }
    if (expectedPrefix !== undefined && !value.startsWith(expectedPrefix)) {
        errors.push(issue('FLOW_WRITE_NAMESPACE_FORBIDDEN', `contract.output.ref must target ${expectedPrefix}`, path));
    }
}
function validateCases(stepKey, value, path, errors) {
    if (!isRecord(value) || Object.keys(value).length === 0) {
        errors.push(issue('FLOW_REQUIRED_FIELD_MISSING', 'cases must be a non-empty object', path));
        return false;
    }
    for (const [caseKey, targetStepId] of Object.entries(value)) {
        if (!isNonEmptyString(targetStepId)) {
            errors.push(issue('FLOW_REQUIRED_FIELD_MISSING', `cases.${caseKey} must be a non-empty step id`, `${path}.${caseKey}`));
        }
    }
    return true;
}
function validateTerminalResult(stepKey, step, errors) {
    if (!isRecord(step.result) || !isJsonSafe(step.result)) {
        errors.push(issue('FLOW_TERMINAL_RESULT_INVALID', 'TERMINAL.result must be a JSON-safe object', stepPath(stepKey, 'result')));
        return;
    }
    if (!isNonEmptyString(step.result.outcome)) {
        errors.push(issue('FLOW_TERMINAL_RESULT_INVALID', 'TERMINAL.result.outcome is required', stepPath(stepKey, 'result.outcome')));
    }
    if (step.result.status !== step.subtype) {
        errors.push(issue('FLOW_TERMINAL_RESULT_INVALID', 'TERMINAL.result.status must match TERMINAL subtype', stepPath(stepKey, 'result.status')));
    }
}
function validateExecutableProcessStep(stepKey, rawStep, step, errors) {
    validateAllowedFields(stepKey, rawStep, EXECUTABLE_PROCESS_ALLOWED_FIELDS, errors);
    pushRequiredString(errors, step.artefactId, stepPath(stepKey, 'artefactId'), 'artefactId');
    const contract = step.contract;
    if (!contract || typeof contract !== 'object') {
        errors.push(issue('FLOW_REQUIRED_FIELD_MISSING', 'contract is required', stepPath(stepKey, 'contract')));
    }
    else {
        if (contract.input === undefined || typeof contract.input !== 'object') {
            errors.push(issue('FLOW_REQUIRED_FIELD_MISSING', 'contract.input.ref is required', stepPath(stepKey, 'contract.input')));
        }
        else {
            validateReadRef(errors, contract.input.ref, stepPath(stepKey, 'contract.input.ref'));
        }
        if (contract.output === undefined || typeof contract.output !== 'object') {
            errors.push(issue('FLOW_REQUIRED_FIELD_MISSING', 'contract.output.ref is required', stepPath(stepKey, 'contract.output')));
        }
        else {
            validateWriteRef(errors, contract.output.ref, stepPath(stepKey, 'contract.output.ref'));
        }
    }
    pushRequiredString(errors, step.nextStepId, stepPath(stepKey, 'nextStepId'), 'nextStepId');
}
function validateRouteStep(stepKey, rawStep, step, errors) {
    validateAllowedFields(stepKey, rawStep, ROUTE_ALLOWED_FIELDS, errors);
    validateReadRef(errors, step.factRef, stepPath(stepKey, 'factRef'));
    validateCases(stepKey, step.cases, stepPath(stepKey, 'cases'), errors);
    if (!isNonEmptyString(step.defaultNextStepId)) {
        errors.push(issue('FLOW_ROUTE_DEFAULT_MISSING', 'ROUTE.defaultNextStepId is required', stepPath(stepKey, 'defaultNextStepId')));
    }
}
function validateSwitchStep(stepKey, rawStep, step, errors) {
    validateAllowedFields(stepKey, rawStep, SWITCH_ALLOWED_FIELDS, errors);
    pushRequiredString(errors, step.decisionSetId, stepPath(stepKey, 'decisionSetId'), 'decisionSetId');
    validateCases(stepKey, step.cases, stepPath(stepKey, 'cases'), errors);
    if (!isNonEmptyString(step.defaultNextStepId)) {
        errors.push(issue('FLOW_SWITCH_DEFAULT_MISSING', 'SWITCH.defaultNextStepId is required', stepPath(stepKey, 'defaultNextStepId')));
    }
}
function validateEffectStep(stepKey, rawStep, step, errors) {
    if (step.subtype === 'SUBFLOW') {
        validateAllowedFields(stepKey, rawStep, SUBFLOW_EFFECT_ALLOWED_FIELDS, errors);
        pushRequiredString(errors, step.operationId, stepPath(stepKey, 'operationId'), 'operationId');
        pushRequiredString(errors, step.flowId, stepPath(stepKey, 'flowId'), 'flowId');
        pushRequiredString(errors, step.flowVersion, stepPath(stepKey, 'flowVersion'), 'flowVersion');
        if (step.inputRef === undefined) {
            errors.push(issue('FLOW_REQUIRED_FIELD_MISSING', 'inputRef is required', stepPath(stepKey, 'inputRef')));
        }
        else {
            validateReadRef(errors, step.inputRef, stepPath(stepKey, 'inputRef'));
        }
        pushRequiredString(errors, step.nextStepId, stepPath(stepKey, 'nextStepId'), 'nextStepId');
        return;
    }
    validateAllowedFields(stepKey, rawStep, EFFECT_ALLOWED_FIELDS, errors);
    pushRequiredString(errors, step.operationId, stepPath(stepKey, 'operationId'), 'operationId');
    if (step.inputRef === undefined) {
        errors.push(issue('FLOW_REQUIRED_FIELD_MISSING', 'inputRef is required', stepPath(stepKey, 'inputRef')));
    }
    else {
        validateReadRef(errors, step.inputRef, stepPath(stepKey, 'inputRef'));
    }
    pushRequiredString(errors, step.nextStepId, stepPath(stepKey, 'nextStepId'), 'nextStepId');
}
function validateWaitStep(stepKey, rawStep, step, errors) {
    validateAllowedFields(stepKey, rawStep, WAIT_ALLOWED_FIELDS, errors);
    pushRequiredString(errors, step.sourceStepId, stepPath(stepKey, 'sourceStepId'), 'sourceStepId');
    pushRequiredString(errors, step.nextStepId, stepPath(stepKey, 'nextStepId'), 'nextStepId');
    if (!isNonEmptyString(step.onErrorStepId)) {
        errors.push(issue('FLOW_WAIT_BRANCH_MISSING', 'WAIT.onErrorStepId is required', stepPath(stepKey, 'onErrorStepId')));
    }
    if (!isNonEmptyString(step.onTimeoutStepId)) {
        errors.push(issue('FLOW_WAIT_BRANCH_MISSING', 'WAIT.onTimeoutStepId is required', stepPath(stepKey, 'onTimeoutStepId')));
    }
}
function validateTerminalStep(stepKey, rawStep, step, errors) {
    validateAllowedFields(stepKey, rawStep, TERMINAL_ALLOWED_FIELDS, errors);
    validateTerminalResult(stepKey, step, errors);
}
function validateStep(stepKey, rawStep, errors) {
    if (!isRecord(rawStep)) {
        errors.push(issue('FLOW_REQUIRED_FIELD_MISSING', 'Step definition must be an object', stepPath(stepKey)));
        return null;
    }
    const stepIdOk = pushRequiredString(errors, rawStep.id, stepPath(stepKey, 'id'), 'id');
    const stepTypeOk = pushRequiredString(errors, rawStep.type, stepPath(stepKey, 'type'), 'type');
    const stepSubtypeOk = pushRequiredString(errors, rawStep.subtype, stepPath(stepKey, 'subtype'), 'subtype');
    if (rawStep.metadata !== undefined && !isJsonSafe(rawStep.metadata)) {
        errors.push(issue('FLOW_REQUIRED_FIELD_MISSING', 'metadata must be JSON-safe', stepPath(stepKey, 'metadata')));
    }
    if (!stepIdOk || !stepTypeOk || !stepSubtypeOk)
        return null;
    if (rawStep.id !== stepKey) {
        errors.push(issue('FLOW_STEP_ID_MISMATCH', 'Step key must match step.id', stepPath(stepKey, 'id'), {
            key: stepKey,
            stepId: rawStep.id,
        }));
    }
    if (!STEP_TYPES.has(rawStep.type)) {
        errors.push(issue('FLOW_INVALID_TYPE', `Unsupported step type: ${String(rawStep.type)}`, stepPath(stepKey, 'type')));
        return null;
    }
    const step = rawStep;
    if (step.type === 'PROCESS') {
        if (PROCESS_EXEC_SUBTYPES.has(step.subtype)) {
            validateExecutableProcessStep(stepKey, rawStep, step, errors);
            return step;
        }
        errors.push(issue('FLOW_INVALID_SUBTYPE', `Unsupported PROCESS subtype: ${String(step.subtype)}`, stepPath(stepKey, 'subtype')));
        return null;
    }
    if (step.type === 'CONTROL') {
        if (step.subtype === 'ROUTE') {
            validateRouteStep(stepKey, rawStep, step, errors);
            return step;
        }
        if (step.subtype === 'SWITCH') {
            validateSwitchStep(stepKey, rawStep, step, errors);
            return step;
        }
        errors.push(issue('FLOW_INVALID_SUBTYPE', `Unsupported CONTROL subtype: ${String(step.subtype)}`, stepPath(stepKey, 'subtype')));
        return null;
    }
    if (step.type === 'EFFECT') {
        if (!EFFECT_SUBTYPES.has(step.subtype)) {
            errors.push(issue('FLOW_INVALID_SUBTYPE', `Unsupported EFFECT subtype: ${String(step.subtype)}`, stepPath(stepKey, 'subtype')));
            return null;
        }
        validateEffectStep(stepKey, rawStep, step, errors);
        return step;
    }
    if (step.type === 'WAIT') {
        if (!WAIT_SUBTYPES.has(step.subtype)) {
            errors.push(issue('FLOW_INVALID_SUBTYPE', `Unsupported WAIT subtype: ${String(step.subtype)}`, stepPath(stepKey, 'subtype')));
            return null;
        }
        validateWaitStep(stepKey, rawStep, step, errors);
        return step;
    }
    if (!TERMINAL_SUBTYPES.has(step.subtype)) {
        errors.push(issue('FLOW_INVALID_SUBTYPE', `Unsupported TERMINAL subtype: ${String(step.subtype)}`, stepPath(stepKey, 'subtype')));
        return null;
    }
    validateTerminalStep(stepKey, rawStep, step, errors);
    return step;
}
function collectTargets(step) {
    if (step.type === 'PROCESS') {
        return [step.nextStepId];
    }
    if (step.type === 'CONTROL') {
        return [...Object.values(step.cases), step.defaultNextStepId];
    }
    if (step.type === 'EFFECT') {
        const targets = [step.nextStepId];
        if (step.onErrorStepId !== undefined)
            targets.push(step.onErrorStepId);
        if (step.onTimeoutStepId !== undefined)
            targets.push(step.onTimeoutStepId);
        return targets;
    }
    if (step.type === 'WAIT') {
        return [step.nextStepId, step.onErrorStepId, step.onTimeoutStepId];
    }
    return [];
}
function validateGraph(flow, stepsById, errors) {
    const stepIds = new Set(Object.keys(stepsById));
    for (const step of Object.values(stepsById)) {
        for (const targetStepId of collectTargets(step)) {
            if (!stepIds.has(targetStepId)) {
                errors.push(issue('FLOW_STEP_REF_NOT_FOUND', `Transition target not found: ${targetStepId}`, undefined, {
                    stepId: step.id,
                    targetStepId,
                }));
            }
        }
    }
    for (const step of Object.values(stepsById)) {
        if (step.type !== 'WAIT')
            continue;
        const sourceStep = stepsById[step.sourceStepId];
        if (!sourceStep || sourceStep.type !== 'EFFECT') {
            errors.push(issue('FLOW_WAIT_SOURCE_INVALID', 'WAIT.sourceStepId must reference an EFFECT step', stepPath(step.id, 'sourceStepId')));
        }
    }
    if (!stepIds.has(flow.entryStepId)) {
        errors.push(issue('FLOW_ENTRY_STEP_NOT_FOUND', `entryStepId is not present in steps: ${flow.entryStepId}`, rootPath('entryStepId')));
        return;
    }
    const reachable = new Set();
    const queue = [flow.entryStepId];
    while (queue.length > 0) {
        const currentStepId = queue.shift();
        if (reachable.has(currentStepId))
            continue;
        reachable.add(currentStepId);
        const currentStep = stepsById[currentStepId];
        if (!currentStep)
            continue;
        for (const targetStepId of collectTargets(currentStep)) {
            if (!reachable.has(targetStepId))
                queue.push(targetStepId);
        }
    }
    for (const stepId of Object.keys(stepsById)) {
        if (!reachable.has(stepId)) {
            errors.push(issue('FLOW_ORPHAN_STEP', `Step is unreachable from entryStepId: ${stepId}`, stepPath(stepId), { stepId }));
        }
    }
    const reachableTerminalCount = Object.values(stepsById).filter((step) => step.type === 'TERMINAL' && reachable.has(step.id)).length;
    if (reachableTerminalCount === 0) {
        errors.push(issue('FLOW_TERMINAL_NOT_REACHABLE', 'Flow must contain at least one reachable TERMINAL step'));
    }
}
export function validateFlow(flow, _options = {}) {
    const errors = [];
    const warnings = [];
    if (!isRecord(flow)) {
        return {
            isValid: false,
            errors: [issue('FLOW_REQUIRED_FIELD_MISSING', 'Flow must be an object', '$')],
            warnings,
        };
    }
    pushRequiredString(errors, flow.id, rootPath('id'), 'id', 'FLOW_ID_REQUIRED');
    pushRequiredString(errors, flow.version, rootPath('version'), 'version', 'FLOW_VERSION_REQUIRED');
    pushRequiredString(errors, flow.entryStepId, rootPath('entryStepId'), 'entryStepId', 'FLOW_ENTRY_STEP_NOT_FOUND');
    if (flow.metadata !== undefined && !isJsonSafe(flow.metadata)) {
        errors.push(issue('FLOW_REQUIRED_FIELD_MISSING', 'metadata must be JSON-safe', rootPath('metadata')));
    }
    if (!isRecord(flow.steps) || Object.keys(flow.steps).length === 0) {
        errors.push(issue('FLOW_STEPS_EMPTY', 'steps must be a non-empty object', rootPath('steps')));
        return { isValid: false, errors, warnings };
    }
    const typedFlow = flow;
    const validStepsById = {};
    for (const [stepKey, rawStep] of Object.entries(typedFlow.steps)) {
        const validatedStep = validateStep(stepKey, rawStep, errors);
        if (validatedStep)
            validStepsById[stepKey] = validatedStep;
    }
    if (Object.keys(validStepsById).length > 0) {
        validateGraph(typedFlow, validStepsById, errors);
    }
    return {
        isValid: errors.length === 0,
        errors,
        warnings,
    };
}
export function prepareFlow(flow, options = {}) {
    const validation = validateFlow(flow, options);
    if (!validation.isValid) {
        throw new XCompileError('Flow preparation failed', validation.errors);
    }
    return createPreparedFlow(flow);
}
