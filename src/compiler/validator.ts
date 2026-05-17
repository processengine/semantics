import { createPreparedFlow } from './compiled.js';
import type { PrepareFlowOptions, ValidateFlowOptions } from './contracts.js';
import type {
  DataProcessStepDefinition,
  EffectStepDefinition,
  FlowDefinition,
  RouteStepDefinition,
  StepDefinition,
  StepId,
  TerminalStepDefinition,
  WaitStepDefinition,
} from '../dsl/types.js';
import { XCompileError } from '../errors/index.js';
import type { ValidationIssue, ValidationResult } from '../errors/types.js';
import { isNonEmptyString, isRecord } from '../utils/guards.js';
import { isJsonSafe } from '../utils/json.js';

export type { ValidationIssue, ValidationResult } from '../errors/types.js';

// Flow 5 taxonomy — exactly one form for each category
const PROCESS_SUBTYPES = new Set(['DATA']);
const CONTROL_SUBTYPES = new Set(['ROUTE']);
const EFFECT_SUBTYPES = new Set(['COMMAND', 'CALL', 'SUBFLOW']);
const WAIT_SUBTYPES = new Set(['MESSAGE']);
const TERMINAL_SUBTYPES = new Set(['COMPLETE', 'FAIL']);
const REMOVED_PROCESS_SUBTYPES = new Set(['RULES', 'MAPPINGS', 'DECISIONS']);
const REMOVED_CONTROL_SUBTYPES = new Set(['SWITCH']);

// Allowed field sets — whitelist, not blacklist
const FLOW_ALLOWED = new Set(['id', 'version', 'title', 'description', 'entryStepId', 'steps', 'metadata']);
const BASE_ALLOWED = new Set(['id', 'type', 'subtype', 'title', 'description', 'metadata']);
const DATA_ALLOWED = new Set([...BASE_ALLOWED, 'artefactId', 'nextStepId']);
const ROUTE_ALLOWED = new Set([...BASE_ALLOWED, 'ref', 'cases', 'defaultNextStepId']);
const EFFECT_ALLOWED = new Set([...BASE_ALLOWED, 'operationId', 'inputRef', 'nextStepId', 'onErrorStepId', 'onTimeoutStepId']);
const SUBFLOW_ALLOWED = new Set([...EFFECT_ALLOWED, 'flowId', 'flowVersion']);
const WAIT_ALLOWED = new Set([...BASE_ALLOWED, 'sourceStepId', 'nextStepId', 'onErrorStepId', 'onTimeoutStepId']);
const TERMINAL_ALLOWED = new Set([...BASE_ALLOWED, 'result', 'resultRef']);

function issue(code: string, message: string, path?: string): ValidationIssue {
  const i: ValidationIssue = { code, message };
  if (path) i.path = path;
  return i;
}

function validateStepBase(step: Record<string, unknown>, path: string, issues: ValidationIssue[]): void {
  if (!isNonEmptyString(step['title'])) {
    issues.push(issue('FLOW_STEP_TITLE_MISSING', `Step "${step['id']}" must have a non-empty title`, `${path}.title`));
  }
  if (!isNonEmptyString(step['description'])) {
    issues.push(issue('FLOW_STEP_DESCRIPTION_MISSING', `Step "${step['id']}" must have a non-empty description`, `${path}.description`));
  }
  // metadata must be a JSON-safe plain object if provided
  if (step['metadata'] !== undefined) {
    if (!isRecord(step['metadata']) || !isJsonSafe(step['metadata'])) {
      issues.push(issue('FLOW_METADATA_INVALID', `Step "${step['id']}" metadata must be a JSON-safe plain object`, `${path}.metadata`));
    }
  }
}

function checkForbiddenFields(obj: Record<string, unknown>, allowed: Set<string>, path: string, issues: ValidationIssue[]): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      issues.push(issue('FLOW_STEP_FORBIDDEN_FIELD', `Field "${key}" is not allowed on this step type in Flow 5`, `${path}.${key}`));
    }
  }
}

// Validate that a transition target stepId exists in the flow
function requireStepExists(stepId: unknown, stepIds: Set<StepId>, path: string, issues: ValidationIssue[]): void {
  if (!isNonEmptyString(stepId)) return; // presence check handled separately
  if (!stepIds.has(stepId)) {
    issues.push(issue('FLOW_TRANSITION_NOT_FOUND', `Step "${stepId}" referenced in transition does not exist in steps`, path));
  }
}

function validateDataStep(step: DataProcessStepDefinition, path: string, stepIds: Set<StepId>, issues: ValidationIssue[]): void {
  const s = step as unknown as Record<string, unknown>;
  checkForbiddenFields(s, DATA_ALLOWED, path, issues);
  validateStepBase(s, path, issues);

  if (!isNonEmptyString(step.artefactId)) {
    issues.push(issue('FLOW_DATA_ARTEFACT_MISSING', `PROCESS/DATA step "${step.id}" must have a non-empty artefactId`, `${path}.artefactId`));
  }
  if (!isNonEmptyString(step.nextStepId)) {
    issues.push(issue('FLOW_STEP_NEXT_MISSING', `PROCESS/DATA step "${step.id}" must have a non-empty nextStepId`, `${path}.nextStepId`));
  } else {
    requireStepExists(step.nextStepId, stepIds, `${path}.nextStepId`, issues);
  }

  // Explicitly reject old Flow3 contract fields with diagnostic messages
  if ('contract' in s)      issues.push(issue('FLOW_DATA_STEP_FORBIDDEN_FIELD', `PROCESS/DATA step "${step.id}" must not have "contract". Input/output is owned by the dataflow artifact.`, `${path}.contract`));
  if ('inputRef' in s)      issues.push(issue('FLOW_DATA_STEP_FORBIDDEN_FIELD', `PROCESS/DATA step "${step.id}" must not have "inputRef"`, `${path}.inputRef`));
  if ('outputRef' in s)     issues.push(issue('FLOW_DATA_STEP_FORBIDDEN_FIELD', `PROCESS/DATA step "${step.id}" must not have "outputRef"`, `${path}.outputRef`));
  if ('cases' in s)         issues.push(issue('FLOW_DATA_STEP_FORBIDDEN_FIELD', `PROCESS/DATA step "${step.id}" must not have "cases". Routing belongs to CONTROL/ROUTE.`, `${path}.cases`));
  if ('onErrorStepId' in s) issues.push(issue('FLOW_DATA_STEP_FORBIDDEN_FIELD', `PROCESS/DATA step "${step.id}" must not have "onErrorStepId". DATA is synchronous and pure.`, `${path}.onErrorStepId`));
}

function validateRouteStep(step: RouteStepDefinition, path: string, stepIds: Set<StepId>, issues: ValidationIssue[]): void {
  const s = step as unknown as Record<string, unknown>;
  checkForbiddenFields(s, ROUTE_ALLOWED, path, issues);
  validateStepBase(s, path, issues);

  if ('factRef' in s)       issues.push(issue('FLOW_ROUTE_FACTREF_REMOVED', `CONTROL/ROUTE step "${step.id}" uses "factRef" which was removed in Flow 5. Use "ref" instead.`, `${path}.factRef`));
  if ('decisionSetId' in s) issues.push(issue('FLOW_ROUTE_DECISIONSETID_REMOVED', `CONTROL/ROUTE step "${step.id}" uses "decisionSetId" which was removed in Flow 5. Use "ref" with explicit path.`, `${path}.decisionSetId`));

  if (!isNonEmptyString(step.ref)) {
    issues.push(issue('FLOW_ROUTE_REF_MISSING', `CONTROL/ROUTE step "${step.id}" must have a non-empty "ref"`, `${path}.ref`));
  }
  if (!isRecord(step.cases) || Object.keys(step.cases).length === 0) {
    issues.push(issue('FLOW_ROUTE_CASES_MISSING', `CONTROL/ROUTE step "${step.id}" must have at least one case`, `${path}.cases`));
  } else {
    for (const [caseKey, targetId] of Object.entries(step.cases)) {
      requireStepExists(targetId, stepIds, `${path}.cases.${caseKey}`, issues);
    }
  }
  if (!isNonEmptyString(step.defaultNextStepId)) {
    issues.push(issue('FLOW_ROUTE_DEFAULT_MISSING', `CONTROL/ROUTE step "${step.id}" must have a defaultNextStepId`, `${path}.defaultNextStepId`));
  } else {
    requireStepExists(step.defaultNextStepId, stepIds, `${path}.defaultNextStepId`, issues);
  }
}

function validateEffectStep(step: EffectStepDefinition, path: string, stepIds: Set<StepId>, issues: ValidationIssue[]): void {
  const s = step as unknown as Record<string, unknown>;
  const allowed = step.subtype === 'SUBFLOW' ? SUBFLOW_ALLOWED : EFFECT_ALLOWED;
  checkForbiddenFields(s, allowed, path, issues);
  validateStepBase(s, path, issues);

  if (!isNonEmptyString(step.operationId)) {
    issues.push(issue('FLOW_EFFECT_OPERATION_MISSING', `EFFECT step "${step.id}" must have a non-empty operationId`, `${path}.operationId`));
  }
  if (typeof s['inputRef'] === 'object' && s['inputRef'] !== null) {
    issues.push(issue('FLOW_OBJECT_INPUTREF_REMOVED', `EFFECT step "${step.id}" inputRef must be a string PathRef. Object inputRef was removed in Flow 5. Use an explicit data preparation PROCESS/DATA step.`, `${path}.inputRef`));
  } else if (!isNonEmptyString(step.inputRef)) {
    issues.push(issue('FLOW_EFFECT_INPUT_MISSING', `EFFECT step "${step.id}" must have a non-empty inputRef`, `${path}.inputRef`));
  }
  if (!isNonEmptyString(step.nextStepId)) {
    issues.push(issue('FLOW_STEP_NEXT_MISSING', `EFFECT step "${step.id}" must have nextStepId`, `${path}.nextStepId`));
  } else {
    requireStepExists(step.nextStepId, stepIds, `${path}.nextStepId`, issues);
  }
  // onErrorStepId is required in Flow 5 — external failure is a lifecycle outcome
  if (!isNonEmptyString(step.onErrorStepId)) {
    issues.push(issue('FLOW_EFFECT_ON_ERROR_MISSING', `EFFECT step "${step.id}" must have onErrorStepId. External failure is a lifecycle outcome that must be explicitly handled.`, `${path}.onErrorStepId`));
  } else {
    requireStepExists(step.onErrorStepId, stepIds, `${path}.onErrorStepId`, issues);
  }
  if (isNonEmptyString(step.onTimeoutStepId)) {
    requireStepExists(step.onTimeoutStepId, stepIds, `${path}.onTimeoutStepId`, issues);
  }

  if (step.subtype === 'SUBFLOW') {
    const sf = step as import('../dsl/types.js').SubflowEffectStepDefinition;
    if (!isNonEmptyString(sf.flowId)) issues.push(issue('FLOW_SUBFLOW_FLOW_ID_MISSING', `SUBFLOW step "${step.id}" must have a non-empty flowId`, `${path}.flowId`));
    if (!isNonEmptyString(sf.flowVersion)) issues.push(issue('FLOW_SUBFLOW_FLOW_VERSION_MISSING', `SUBFLOW step "${step.id}" must have a non-empty flowVersion`, `${path}.flowVersion`));
  }
}

function validateWaitStep(step: WaitStepDefinition, path: string, stepIds: Set<StepId>, allSteps: Record<string, unknown>, issues: ValidationIssue[]): void {
  const s = step as unknown as Record<string, unknown>;
  checkForbiddenFields(s, WAIT_ALLOWED, path, issues);
  validateStepBase(s, path, issues);

  if (!isNonEmptyString(step.sourceStepId)) {
    issues.push(issue('FLOW_WAIT_SOURCE_MISSING', `WAIT step "${step.id}" must have sourceStepId`, `${path}.sourceStepId`));
  } else {
    requireStepExists(step.sourceStepId, stepIds, `${path}.sourceStepId`, issues);
    // sourceStepId must reference an EFFECT step
    const sourceStep = allSteps[step.sourceStepId] as Record<string, unknown> | undefined;
    if (sourceStep && sourceStep['type'] !== 'EFFECT') {
      issues.push(issue('FLOW_WAIT_SOURCE_NOT_EFFECT', `WAIT step "${step.id}" sourceStepId must reference an EFFECT step, but "${step.sourceStepId}" is type "${sourceStep['type']}"`, `${path}.sourceStepId`));
    }
    if (step.sourceStepId === step.id) {
      issues.push(issue('FLOW_WAIT_SOURCE_NOT_EFFECT', `WAIT step "${step.id}" sourceStepId must not reference itself`, `${path}.sourceStepId`));
    }
  }
  if (!isNonEmptyString(step.nextStepId)) {
    issues.push(issue('FLOW_STEP_NEXT_MISSING', `WAIT step "${step.id}" must have nextStepId`, `${path}.nextStepId`));
  } else {
    requireStepExists(step.nextStepId, stepIds, `${path}.nextStepId`, issues);
  }
  if (!isNonEmptyString(step.onErrorStepId)) {
    issues.push(issue('FLOW_WAIT_ERROR_MISSING', `WAIT step "${step.id}" must have onErrorStepId`, `${path}.onErrorStepId`));
  } else {
    requireStepExists(step.onErrorStepId, stepIds, `${path}.onErrorStepId`, issues);
  }
  if (!isNonEmptyString(step.onTimeoutStepId)) {
    issues.push(issue('FLOW_WAIT_TIMEOUT_MISSING', `WAIT step "${step.id}" must have onTimeoutStepId`, `${path}.onTimeoutStepId`));
  } else {
    requireStepExists(step.onTimeoutStepId, stepIds, `${path}.onTimeoutStepId`, issues);
  }
}

function validateTerminalStep(step: TerminalStepDefinition, path: string, issues: ValidationIssue[]): void {
  const s = step as unknown as Record<string, unknown>;
  checkForbiddenFields(s, TERMINAL_ALLOWED, path, issues);
  validateStepBase(s, path, issues);

  const hasResult = step.result !== undefined;
  const hasRef = step.resultRef !== undefined;

  if (hasResult && hasRef) {
    issues.push(issue('FLOW_TERMINAL_RESULT_AMBIGUOUS', `TERMINAL step "${step.id}" must have exactly one of result or resultRef, not both`, `${path}.result`));
  } else if (!hasResult && !hasRef) {
    issues.push(issue('FLOW_TERMINAL_RESULT_MISSING', `TERMINAL step "${step.id}" must have either result or resultRef`, `${path}.result`));
  }

  if (hasRef) {
    if (typeof step.resultRef !== 'string' || !step.resultRef.startsWith('$.context.data.results.')) {
      issues.push(issue('FLOW_TERMINAL_RESULTREF_INVALID', `TERMINAL step "${step.id}" resultRef must start with "$.context.data.results."`, `${path}.resultRef`));
    }
  }

  if (hasResult && step.result) {
    if (!isJsonSafe(step.result)) {
      issues.push(issue('FLOW_TERMINAL_RESULT_NOT_JSON_SAFE', `TERMINAL step "${step.id}" result must be JSON-safe`, `${path}.result`));
    }
    if (!isNonEmptyString(step.result.status)) {
      issues.push(issue('FLOW_TERMINAL_RESULT_STATUS_MISSING', `TERMINAL step "${step.id}" result must have a non-empty status`, `${path}.result.status`));
    } else if (step.result.status !== step.subtype) {
      // result.status must match the TERMINAL subtype: COMPLETE/FAIL
      issues.push(issue('FLOW_TERMINAL_RESULT_STATUS_MISMATCH', `TERMINAL step "${step.id}" result.status "${step.result.status}" must match subtype "${step.subtype}"`, `${path}.result.status`));
    }
    if (!isNonEmptyString(step.result.outcome)) {
      issues.push(issue('FLOW_TERMINAL_RESULT_OUTCOME_MISSING', `TERMINAL step "${step.id}" result must have a non-empty outcome`, `${path}.result.outcome`));
    }
  }
}

function validateStep(step: StepDefinition, path: string, stepIds: Set<StepId>, allSteps: Record<string, unknown>, issues: ValidationIssue[]): void {
  const s = step as unknown as Record<string, unknown>;

  if (step.type === 'PROCESS' && REMOVED_PROCESS_SUBTYPES.has(step.subtype)) {
    issues.push(issue('FLOW_INVALID_SUBTYPE', `PROCESS/${step.subtype} is not supported in Flow 5. Wrap it in PROCESS/DATA with a dataflow artifact.`, path));
    return;
  }
  if (step.type === 'CONTROL' && REMOVED_CONTROL_SUBTYPES.has(step.subtype)) {
    issues.push(issue('FLOW_INVALID_SUBTYPE', `CONTROL/${step.subtype} is not supported in Flow 5. Use CONTROL/ROUTE with an explicit "ref" field.`, path));
    return;
  }

  switch (step.type) {
    case 'PROCESS':
      if (!PROCESS_SUBTYPES.has(step.subtype)) { issues.push(issue('FLOW_INVALID_SUBTYPE', `PROCESS/${step.subtype} is not valid in Flow 5. Allowed: PROCESS/DATA`, path)); return; }
      validateDataStep(step as DataProcessStepDefinition, path, stepIds, issues);
      break;
    case 'CONTROL':
      if (!CONTROL_SUBTYPES.has(step.subtype)) { issues.push(issue('FLOW_INVALID_SUBTYPE', `CONTROL/${step.subtype} is not valid in Flow 5. Allowed: CONTROL/ROUTE`, path)); return; }
      validateRouteStep(step as RouteStepDefinition, path, stepIds, issues);
      break;
    case 'EFFECT':
      if (!EFFECT_SUBTYPES.has(step.subtype)) { issues.push(issue('FLOW_INVALID_SUBTYPE', `EFFECT/${step.subtype} is not valid. Allowed: COMMAND, CALL, SUBFLOW`, path)); return; }
      validateEffectStep(step as EffectStepDefinition, path, stepIds, issues);
      break;
    case 'WAIT':
      if (!WAIT_SUBTYPES.has(step.subtype)) { issues.push(issue('FLOW_INVALID_SUBTYPE', `WAIT/${step.subtype} is not valid. Allowed: MESSAGE`, path)); return; }
      validateWaitStep(step as WaitStepDefinition, path, stepIds, allSteps, issues);
      break;
    case 'TERMINAL':
      if (!TERMINAL_SUBTYPES.has(step.subtype)) { issues.push(issue('FLOW_INVALID_SUBTYPE', `TERMINAL/${step.subtype} is not valid. Allowed: COMPLETE, FAIL`, path)); return; }
      validateTerminalStep(step as TerminalStepDefinition, path, issues);
      break;
    default:
      issues.push(issue('FLOW_INVALID_TYPE', `Unknown step type: "${(s)['type']}"`, path));
  }
}

export function validateFlow(source: unknown, options?: ValidateFlowOptions): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!isRecord(source)) {
    return { ok: false, issues: [issue('FLOW_SOURCE_INVALID', 'Flow source must be a non-null object')] };
  }

  for (const key of Object.keys(source)) {
    if (!FLOW_ALLOWED.has(key)) {
      issues.push(issue('FLOW_SOURCE_FORBIDDEN_FIELD', `Flow source field "${key}" is not part of the Flow 5 contract`, key));
    }
  }

  if (!isNonEmptyString(source['id']))          issues.push(issue('FLOW_ID_MISSING', 'Flow must have a non-empty id', 'id'));
  if (!isNonEmptyString(source['version']))      issues.push(issue('FLOW_VERSION_MISSING', 'Flow must have a non-empty version', 'version'));
  if (!isNonEmptyString(source['title']))        issues.push(issue('FLOW_TITLE_MISSING', 'Flow must have a non-empty title', 'title'));
  if (!isNonEmptyString(source['description']))  issues.push(issue('FLOW_DESCRIPTION_MISSING', 'Flow must have a non-empty description', 'description'));
  if (!isNonEmptyString(source['entryStepId']))  issues.push(issue('FLOW_ENTRY_MISSING', 'Flow must have a non-empty entryStepId', 'entryStepId'));

  // metadata: if present, must be a JSON-safe plain object
  if (source['metadata'] !== undefined && (!isRecord(source['metadata']) || !isJsonSafe(source['metadata']))) {
    issues.push(issue('FLOW_METADATA_INVALID', 'Flow metadata must be a JSON-safe plain object', 'metadata'));
  }

  if (!isRecord(source['steps'])) {
    issues.push(issue('FLOW_STEPS_MISSING', 'Flow must have a non-empty steps object', 'steps'));
    return { ok: issues.length === 0, issues };
  }

  const flow = source as unknown as FlowDefinition;
  const stepIds = new Set(Object.keys(flow.steps));
  const allSteps = flow.steps as unknown as Record<string, unknown>;

  if (stepIds.size === 0) {
    issues.push(issue('FLOW_STEPS_EMPTY', 'Flow steps must contain at least one step', 'steps'));
    return { ok: false, issues };
  }

  if (isNonEmptyString(flow.entryStepId) && !stepIds.has(flow.entryStepId)) {
    issues.push(issue('FLOW_ENTRY_NOT_FOUND', `entryStepId "${flow.entryStepId}" does not exist in steps`, 'entryStepId'));
  }

  for (const [id, step] of Object.entries(flow.steps)) {
    if (!isRecord(step)) { issues.push(issue('FLOW_STEP_INVALID', `Step "${id}" must be an object`, `steps.${id}`)); continue; }
    if (step['id'] !== id) issues.push(issue('FLOW_STEP_ID_MISMATCH', `Step id "${step['id']}" does not match key "${id}"`, `steps.${id}.id`));
    if (!isNonEmptyString(step['id']))      issues.push(issue('FLOW_STEP_ID_MISSING', `Step "${id}" must have a non-empty id`, `steps.${id}.id`));
    if (!isNonEmptyString(step['type']))    issues.push(issue('FLOW_STEP_TYPE_MISSING', `Step "${id}" must have a non-empty type`, `steps.${id}.type`));
    if (!isNonEmptyString(step['subtype'])) issues.push(issue('FLOW_STEP_SUBTYPE_MISSING', `Step "${id}" must have a non-empty subtype`, `steps.${id}.subtype`));
    if (!isNonEmptyString(step['id']) || !isNonEmptyString(step['type']) || !isNonEmptyString(step['subtype'])) continue;
    validateStep(step as unknown as StepDefinition, `steps.${id}`, stepIds, allSteps, issues);
  }

  return { ok: issues.length === 0, issues };
}

export function prepareFlow(source: unknown, options?: PrepareFlowOptions): import('./compiled.js').PreparedFlow {
  const validation = validateFlow(source, options);
  if (!validation.ok) {
    throw new XCompileError('Flow validation failed', validation.issues);
  }
  return createPreparedFlow(source as FlowDefinition, options);
}
