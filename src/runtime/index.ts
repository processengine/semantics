import type {
  PreparedEffectStep,
  PreparedControlStep,
  PreparedDataProcessStep,
  PreparedFlow,
  PreparedFlowInternal,
  PreparedStep,
  PreparedTerminalStep,
  PreparedWaitStep,
} from '../compiler/compiled.js';
import { asPreparedFlowInternal } from '../compiler/compiled.js';
import type { TerminalResult } from '../dsl/types.js';
import { XRuntimeError } from '../errors/index.js';
import { isNonEmptyString, isRecord } from '../utils/guards.js';
import { isJsonSafe, type JsonObject, type JsonValue } from '../utils/json.js';
import { getPath, resolveInput, setPath } from '../utils/path.js';
import type {
  CreateProcessStateParams,
  DataflowOutput,
  EffectResult,
  FlowTraceMode,
  NormalizedControlStep,
  NormalizedDataProcessStep,
  NormalizedEffectStep,
  NormalizedProcessStep,
  NormalizedRouteStep,
  NormalizedStep,
  NormalizedTerminalStep,
  NormalizedWaitStep,
  ProcessDataContext,
  ProcessState,
  ResumeEvent,
  StepExecutionRecord,
  StepExecutionStatus,
  StepRuntimeState,
  TimelineEntry,
  TransitionTarget,
  WaitResult,
} from './types.js';
import { FLOW5_STATE_VERSION } from './types.js';

interface NormalizedDataProcessStepInternal extends NormalizedDataProcessStep {
  next: TransitionTarget;
}

interface RouteResolution {
  selectedNextStepId: string;
  ref: string;
  resolvedValue: JsonValue;
  selectedCase: string | null;
  fallback: boolean;
  fallbackReason: string | null;
}

interface NormalizedRouteStepInternal extends NormalizedRouteStep {
  next: TransitionTarget;
  route: RouteResolution;
}

export type {
  CreateProcessStateParams,
  EffectResult,
  FlowTraceMode,
  NormalizedEffectStep,
  NormalizedControlStep,
  NormalizedDataProcessStep,
  NormalizedProcessStep,
  NormalizedRouteStep,
  NormalizedStep,
  NormalizedTerminalStep,
  NormalizedWaitStep,
  ProcessDataContext,
  ProcessState,
  ResumeEvent,
  StepRuntimeState,
  TimelineEntry,
  WaitResult,
} from './types.js';
export { FLOW5_STATE_VERSION } from './types.js';

function now(): string {
  return new Date().toISOString();
}

function cloneState(state: ProcessState): ProcessState {
  return structuredClone(state);
}

function buildData(): ProcessDataContext {
  return {
    payloads: {},
    facts: {},
    decisions: {},
    checks: {},
    results: {},
  };
}

function ensureTraceMode(value: unknown): FlowTraceMode {
  if (value === 'off' || value === 'basic' || value === 'verbose') return value;
  throw new XRuntimeError('FLOW_STATE_INVALID', 'traceMode must be "off", "basic", or "verbose"', {
    traceMode: value,
  });
}

function ensureNonEmptyStringState(value: unknown, field: string, code: 'FLOW_STATE_INVALID' | 'FLOW_REQUEST_ID_MISSING' = 'FLOW_STATE_INVALID'): string {
  if (!isNonEmptyString(value)) {
    throw new XRuntimeError(code, `${field} must be a non-empty string`, { field });
  }
  return value;
}

function ensureJsonObject(value: unknown, field: string): JsonObject {
  if (value === undefined) return {};
  if (!isRecord(value) || !isJsonSafe(value)) {
    throw new XRuntimeError('FLOW_STATE_INVALID', `${field} must be a JSON-safe object`, { field });
  }
  return structuredClone(value) as JsonObject;
}

function ensureRuntimeObject(value: unknown, method: string, field: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new XRuntimeError('FLOW_RUNTIME_INPUT_INVALID', `${method}: ${field} must be a non-null object`, { field });
  }
}

function ensurePreparedFlowInput(value: unknown, method: string): PreparedFlowInternal {
  ensureRuntimeObject(value, method, 'flow');
  const flow = asPreparedFlowInternal(value as unknown as PreparedFlow);
  if (!isNonEmptyString(flow.id) || !isNonEmptyString(flow.version) || !isNonEmptyString(flow.entryStepId) || !isRecord(flow.stepsById)) {
    throw new XRuntimeError('FLOW_RUNTIME_INPUT_INVALID', `${method}: flow must be a prepared flow object from prepareFlow()`, {});
  }
  return flow;
}

function ensureProcessStateInput(value: unknown, method: string): asserts value is ProcessState {
  ensureRuntimeObject(value, method, 'state');
}

function ensureStepIdInput(value: unknown, method: string): string {
  if (!isNonEmptyString(value)) {
    throw new XRuntimeError('FLOW_RUNTIME_INPUT_INVALID', `${method}: stepId must be a non-empty string`, { stepId: value });
  }
  return value;
}

function ensureJsonSafeValue(value: unknown, field: string): void {
  if (!isJsonSafe(value)) {
    throw new XRuntimeError('FLOW_RESULT_SHAPE_INVALID', `${field} must be JSON-safe`, { field });
  }
}

function ensurePreparedStep(flow: PreparedFlowInternal, stepId: string): PreparedStep {
  const step = flow.stepsById[stepId];
  if (!step) {
    throw new XRuntimeError('FLOW_STEP_NOT_FOUND', `Step is not present in preparedFlow: ${stepId}`, { stepId });
  }
  return step;
}

function hasOwn(value: unknown, key: string): boolean {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function containsForbiddenRuntimeWaitResult(state: ProcessState): boolean {
  const raw = state as unknown as Record<string, unknown>;
  if (hasOwn(raw, 'waitResult')) return true;

  const steps = raw['steps'];
  if (!isRecord(steps)) return false;

  for (const stepRuntime of Object.values(steps)) {
    if (!isRecord(stepRuntime)) continue;
    if (hasOwn(stepRuntime, 'waitResult')) return true;
    const executions = stepRuntime['executions'];
    if (!Array.isArray(executions)) continue;
    for (const execution of executions) {
      if (!isRecord(execution)) continue;
      if (hasOwn(execution, 'waitResult')) return true;
      if (hasOwn(execution['command'], 'waitResult')) return true;
      if (hasOwn(execution['subflow'], 'waitResult')) return true;
    }
  }

  return false;
}

function ensureStateV2Shape(state: ProcessState): void {
  const raw = state as unknown as Record<string, unknown>;
  if ('context' in raw) {
    const context = raw['context'];
    if (isRecord(context) && 'effects' in context) {
      throw new XRuntimeError('FLOW_CONTEXT_EFFECTS_FORBIDDEN', 'State v2 must not contain context.effects', {});
    }
    throw new XRuntimeError('FLOW_CONTEXT_FORBIDDEN', 'State v2 must not contain context', {});
  }
  if ('history' in raw || 'currentStepId' in raw || 'currentStepType' in raw || 'currentStepSubtype' in raw) {
    throw new XRuntimeError('FLOW_STATE_V1_FORBIDDEN', 'State v1 fields are forbidden in Flow 5 State v2', {});
  }
  if (containsForbiddenRuntimeWaitResult(state)) {
    throw new XRuntimeError('FLOW_WAIT_RESULT_PERSISTED_FORBIDDEN', 'Persisted runtime waitResult projection is forbidden in Flow 5 State v2', {});
  }
  if (state.stateVersion !== FLOW5_STATE_VERSION) {
    throw new XRuntimeError('FLOW_STATE_INVALID', `stateVersion must be "${FLOW5_STATE_VERSION}"`, { stateVersion: state.stateVersion });
  }
  if (!isRecord(state.current) || !isNonEmptyString(state.current.stepId) || !isNonEmptyString(state.current.type) || !isNonEmptyString(state.current.subtype)) {
    throw new XRuntimeError('FLOW_STATE_INVALID', 'current must contain stepId, type, and subtype', {});
  }
  if (!isRecord(state.input) || !isJsonSafe(state.input)) {
    throw new XRuntimeError('FLOW_STATE_INVALID', 'input must be a JSON-safe object');
  }
  if (!isRecord(state.data) || !isJsonSafe(state.data)) {
    throw new XRuntimeError('FLOW_STATE_INVALID', 'data must be a JSON-safe object');
  }
  for (const zone of ['payloads', 'facts', 'decisions', 'checks', 'results']) {
    if (!isRecord((state.data as Record<string, unknown>)[zone])) {
      throw new XRuntimeError('FLOW_STATE_INVALID', `data.${zone} must be an object`, { zone });
    }
  }
  if (!isRecord(state.steps) || !isJsonSafe(state.steps)) {
    throw new XRuntimeError('FLOW_STEP_EXECUTION_INVALID', 'steps must be a JSON-safe object');
  }
  if (!Array.isArray(state.timeline) || !isJsonSafe(state.timeline)) {
    throw new XRuntimeError('FLOW_TIMELINE_INVALID', 'timeline must be a JSON-safe array');
  }
  if (state.result !== null && (!isRecord(state.result) || !isJsonSafe(state.result))) {
    throw new XRuntimeError('FLOW_STATE_INVALID', 'result must be null or a JSON-safe object');
  }
  if (!isRecord(state.meta) || !isJsonSafe(state.meta)) {
    throw new XRuntimeError('FLOW_STATE_INVALID', 'meta must be a JSON-safe object');
  }
}

function ensureStateMatchesFlow(flow: PreparedFlowInternal, state: ProcessState): PreparedStep {
  ensureNonEmptyStringState(state.processId, 'processId');
  ensureNonEmptyStringState(state.flowId, 'flowId');
  ensureNonEmptyStringState(state.flowVersion, 'flowVersion');
  ensureTraceMode(state.traceMode);
  ensureStateV2Shape(state);

  if (state.status !== 'ACTIVE' && state.status !== 'WAITING' && state.status !== 'COMPLETE' && state.status !== 'FAIL') {
    throw new XRuntimeError('FLOW_STATE_INVALID', 'status must be ACTIVE, WAITING, COMPLETE, or FAIL', { status: state.status });
  }

  if (state.flowId !== flow.id) {
    throw new XRuntimeError('FLOW_FLOW_MISMATCH', 'state.flowId does not belong to preparedFlow.id', {
      stateFlowId: state.flowId,
      flowId: flow.id,
    });
  }

  if (state.flowVersion !== flow.version) {
    throw new XRuntimeError('FLOW_FLOW_MISMATCH', 'state.flowVersion does not match preparedFlow.version', {
      stateFlowVersion: state.flowVersion,
      flowVersion: flow.version,
    });
  }

  const currentStep = ensurePreparedStep(flow, state.current.stepId);
  if (currentStep.type !== state.current.type || currentStep.subtype !== state.current.subtype) {
    throw new XRuntimeError('FLOW_STEP_MISMATCH', 'Current step metadata is inconsistent with preparedFlow', {
      currentStepId: state.current.stepId,
      currentStepType: state.current.type,
      currentStepSubtype: state.current.subtype,
    });
  }

  if (state.status === 'WAITING' && currentStep.type !== 'WAIT') {
    throw new XRuntimeError('FLOW_STEP_MISMATCH', 'WAITING state must point to WAIT step', {
      currentStepId: state.current.stepId,
      status: state.status,
    });
  }

  if ((state.status === 'COMPLETE' || state.status === 'FAIL') && currentStep.type !== 'TERMINAL') {
    throw new XRuntimeError('FLOW_STEP_MISMATCH', 'Terminal state must point to TERMINAL step', {
      currentStepId: state.current.stepId,
      status: state.status,
    });
  }

  return currentStep;
}

function ensureRuntimeAllowed(flow: PreparedFlowInternal, state: ProcessState): PreparedStep {
  const currentStep = ensureStateMatchesFlow(flow, state);
  if (state.status === 'COMPLETE' || state.status === 'FAIL') {
    throw new XRuntimeError('FLOW_TERMINAL_MISUSED', 'Runtime methods cannot be called on terminal process', {
      status: state.status,
      stepId: state.current.stepId,
    });
  }
  return currentStep;
}

function buildTransitionTarget(flow: PreparedFlowInternal, stepId: string): TransitionTarget {
  const step = ensurePreparedStep(flow, stepId);
  const metadata = {
    title: step.title,
    description: step.description,
  };

  if (step.type === 'TERMINAL') {
    const terminalStep = step as PreparedTerminalStep;
    if (terminalStep.resultRef) {
      return {
        stepId: step.id,
        type: 'TERMINAL',
        subtype: step.subtype,
        ...metadata,
        resultRef: terminalStep.resultRef,
      };
    }
    return {
      stepId: step.id,
      type: 'TERMINAL',
      subtype: step.subtype,
      ...metadata,
      result: structuredClone(terminalStep.result!),
    };
  }

  if (step.type === 'WAIT') {
    return {
      stepId: step.id,
      type: 'WAIT',
      subtype: step.subtype,
      ...metadata,
      sourceStepId: step.sourceStepId,
    };
  }

  if (step.type === 'EFFECT') {
    return {
      stepId: step.id,
      type: 'EFFECT',
      subtype: step.subtype,
      ...metadata,
    };
  }

  if (step.type === 'CONTROL') {
    return {
      stepId: step.id,
      type: 'CONTROL',
      subtype: step.subtype,
      ...metadata,
    };
  }

  return {
    stepId: step.id,
    type: 'PROCESS',
    subtype: 'DATA' as const,
    ...metadata,
  };
}

function normalizeRoutingValue(value: unknown, field: string): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new XRuntimeError('FLOW_ROUTING_VALUE_INVALID', `${field} must resolve to scalar value`, { field });
}

function resolveRoute(flow: PreparedFlowInternal, step: PreparedControlStep, state: ProcessState): RouteResolution {
  const routeRef = (step as unknown as Record<string, unknown>)['ref'] as string;
  const routeValue = getPath(state, routeRef);
  if (!routeValue.found) {
    throw new XRuntimeError('FLOW_ROUTE_REF_NOT_RESOLVED', `CONTROL/ROUTE ref not found in state: ${routeRef}`, {
      ref: routeRef,
      stepId: step.id,
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
  const matchedStepId = step.cases[caseKey];
  return {
    ref: routeRef,
    resolvedValue: val as JsonValue,
    selectedCase: matchedStepId ? caseKey : null,
    selectedNextStepId: matchedStepId ?? step.defaultNextStepId,
    fallback: !matchedStepId,
    fallbackReason: matchedStepId ? null : 'defaultNextStepId',
  };
}

function assertValidDataflowWrite(write: unknown, stepId: string): asserts write is { ref: string; value: unknown; itemId: string } {
  if (!isRecord(write)) {
    throw new XRuntimeError('FLOW_DATA_WRITE_INVALID', 'DataflowOutput write must be an object', { stepId });
  }
  const w = write as Record<string, unknown>;
  if (!isNonEmptyString(w['ref'])) {
    throw new XRuntimeError('FLOW_DATA_WRITE_INVALID', 'DataflowOutput write.ref must be a non-empty string', { stepId });
  }
  if (!isNonEmptyString(w['itemId'])) {
    throw new XRuntimeError('FLOW_DATA_WRITE_INVALID', 'DataflowOutput write.itemId must be a non-empty string', { stepId });
  }
  const ref = w['ref'] as string;
  if (!ref.startsWith('$.data.')) {
    throw new XRuntimeError('FLOW_DATA_WRITE_FORBIDDEN_PATH', `DataflowOutput write.ref must start with "$.data.": ${ref}`, { stepId, ref });
  }
  if (!isJsonSafe(w['value'])) {
    throw new XRuntimeError('FLOW_DATA_WRITE_NOT_JSON_SAFE', `DataflowOutput write.value must be JSON-safe for ref: ${ref}`, { stepId, ref });
  }
}

function applyDataflowWrite(state: ProcessState, write: { ref: string; value: unknown; itemId: string }): void {
  const patchedState = setPath(state as unknown as Record<string, unknown>, write.ref, write.value);
  state.data = patchedState['data'] as ProcessDataContext;
}

function nextExecutionId(state: ProcessState): string {
  return `exec-${String(state.timeline.length + 1).padStart(6, '0')}`;
}

function ensureStepRuntime(state: ProcessState, step: PreparedStep | TransitionTarget): StepRuntimeState {
  const stepId = 'stepId' in step ? step.stepId : step.id;
  const existing = state.steps[stepId];
  if (existing) {
    if ('title' in step && step.title && existing.title === undefined) existing.title = step.title;
    if ('description' in step && step.description && existing.description === undefined) existing.description = step.description;
    return existing;
  }
  const runtime: StepRuntimeState = {
    stepId,
    type: step.type,
    subtype: step.subtype,
    status: 'PENDING',
    latestExecutionId: null,
    executions: [],
  };
  if ('title' in step && step.title) {
    runtime.title = step.title;
  }
  if ('description' in step && step.description) {
    runtime.description = step.description;
  }
  state.steps[runtime.stepId] = runtime;
  return runtime;
}

function stepMetadata(step: { title?: string; description?: string }): { title?: string; description?: string } {
  const metadata: { title?: string; description?: string } = {};
  if (step.title !== undefined) metadata.title = step.title;
  if (step.description !== undefined) metadata.description = step.description;
  return metadata;
}

function pushExecution(state: ProcessState, step: PreparedStep | TransitionTarget, record: StepExecutionRecord, timelineKind: TimelineEntry['kind']): StepExecutionRecord {
  const runtime = ensureStepRuntime(state, step);
  runtime.executions.push(record);
  runtime.latestExecutionId = record.executionId;
  runtime.status = record.status;
  state.timeline.push({
    executionId: record.executionId,
    stepId: runtime.stepId,
    kind: timelineKind,
    status: record.status,
    at: record.finishedAt ?? record.startedAt,
  });
  return record;
}

function getLatestExecution(runtime: StepRuntimeState | undefined): StepExecutionRecord | null {
  if (!runtime) return null;
  if (runtime.latestExecutionId) {
    return runtime.executions.find((execution) => execution.executionId === runtime.latestExecutionId) ?? null;
  }
  return runtime.executions[runtime.executions.length - 1] ?? null;
}

function getLatestEffectRequestId(state: ProcessState, sourceStepId: string): string | undefined {
  const latest = getLatestExecution(state.steps[sourceStepId]);
  const requestId = latest?.command?.requestId ?? latest?.subflow?.requestId;
  return isNonEmptyString(requestId) ? requestId : undefined;
}

function setCurrent(state: ProcessState, target: TransitionTarget): void {
  state.current = {
    stepId: target.stepId,
    type: target.type,
    subtype: target.subtype,
  };
}

function resolveTerminalResult(state: ProcessState, target: TransitionTarget): TerminalResult {
  if (target.type !== 'TERMINAL') {
    throw new XRuntimeError('FLOW_STATE_INVALID', 'Target must be TERMINAL', { stepId: target.stepId });
  }

  if (target.resultRef) {
    const resolved = getPath(state, target.resultRef);
    if (!resolved.found || !isRecord(resolved.value) || !isJsonSafe(resolved.value)) {
      throw new XRuntimeError(
        'FLOW_RESULT_REF_NOT_RESOLVED',
        `TERMINAL resultRef path is missing or not a JSON-safe object: ${target.resultRef}`,
        { resultRef: target.resultRef, stepId: target.stepId },
      );
    }
    const dynamic = resolved.value as Record<string, unknown>;
    if (!isNonEmptyString(dynamic['outcome'])) {
      throw new XRuntimeError(
        'FLOW_RESULT_REF_SHAPE_INVALID',
        `Value at resultRef must have a non-empty string "outcome": ${target.resultRef}`,
        { resultRef: target.resultRef, stepId: target.stepId },
      );
    }
    if (dynamic['status'] !== target.subtype) {
      throw new XRuntimeError(
        'FLOW_RESULT_REF_SHAPE_INVALID',
        `Value at resultRef "status" must match TERMINAL subtype "${target.subtype}": ${target.resultRef}`,
        { resultRef: target.resultRef, stepId: target.stepId, status: dynamic['status'] },
      );
    }
    return structuredClone(dynamic) as TerminalResult;
  }

  return structuredClone(target.result!);
}

function finalizeTerminal(state: ProcessState, target: TransitionTarget, at: string): ProcessState {
  if (target.type !== 'TERMINAL') return state;
  const result = resolveTerminalResult(state, target);
  state.status = result.status;
  state.result = result;
  setCurrent(state, target);
  pushExecution(state, target, {
    executionId: nextExecutionId(state),
    attempt: (state.steps[target.stepId]?.executions.length ?? 0) + 1,
    status: 'COMPLETED',
    startedAt: at,
    finishedAt: at,
    failureCode: null,
    reason: null,
    terminal: {
      mode: target.resultRef ? 'resultRef' : 'static',
      resultRef: target.resultRef ?? null,
      result,
    },
  }, 'STEP_COMPLETED');
  return state;
}

function followTransition(state: ProcessState, target: TransitionTarget, at: string): ProcessState {
  if (target.type === 'WAIT') {
    state.status = 'WAITING';
    setCurrent(state, target);
    const requestId = getLatestEffectRequestId(state, target.sourceStepId) ?? null;
    pushExecution(state, target, {
      executionId: nextExecutionId(state),
      attempt: (state.steps[target.stepId]?.executions.length ?? 0) + 1,
      status: 'WAITING',
      startedAt: at,
      finishedAt: null,
      failureCode: null,
      reason: null,
      wait: {
        sourceStepId: target.sourceStepId,
        requestId,
        startedAt: at,
        resumedAt: null,
        outcome: 'WAITING',
      },
    }, 'STEP_WAITING');
    return state;
  }

  if (target.type === 'TERMINAL') {
    return finalizeTerminal(state, target, at);
  }

  state.status = 'ACTIVE';
  setCurrent(state, target);
  return state;
}

function ensureCurrentStep(
  state: ProcessState,
  expectedId: string,
  expectedType: PreparedStep['type'],
  invalidTypeCode: 'FLOW_REDUCE_INVALID_TYPE' | 'FLOW_APPLY_INVALID_TYPE' | 'FLOW_RESUME_INVALID_TYPE',
): void {
  if (state.current.stepId !== expectedId) {
    throw new XRuntimeError('FLOW_STEP_ID_MISMATCH', 'stepId does not match current.stepId', {
      stepId: expectedId,
      currentStepId: state.current.stepId,
    });
  }
  if (state.current.type !== expectedType) {
    throw new XRuntimeError(invalidTypeCode, `Current step must be ${expectedType}`, {
      stepId: expectedId,
      currentStepType: state.current.type,
    });
  }
}

function chooseFailureTarget(
  flow: PreparedFlowInternal,
  stepId: string,
  nextIds: { onErrorStepId?: string; onTimeoutStepId?: string },
  errorCode: string | null,
): TransitionTarget {
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

function normalizeExternalResult(result: EffectResult | ResumeEvent, field: 'effectResult' | 'resumeEvent') {
  if (!isRecord(result)) {
    throw new XRuntimeError(field === 'resumeEvent' ? 'FLOW_RESUME_EVENT_INVALID' : 'FLOW_RUNTIME_INPUT_INVALID', `${field} must be a JSON-safe object`, { field });
  }
  const requestId = ensureNonEmptyStringState(result.requestId, `${field}.requestId`, 'FLOW_REQUEST_ID_MISSING');

  if (result.result !== undefined && result.result !== null) ensureJsonSafeValue(result.result, `${field}.result`);
  if (result.error !== undefined && result.error !== null) ensureJsonSafeValue(result.error, `${field}.error`);
  if (result.errorCode !== undefined && result.errorCode !== null && !isNonEmptyString(result.errorCode)) {
    throw new XRuntimeError('FLOW_RESULT_SHAPE_INVALID', `${field}.errorCode must be a non-empty string or null`);
  }
  if (result.result !== undefined && result.result !== null && result.error !== undefined && result.error !== null) {
    throw new XRuntimeError('FLOW_MIXED_RESULT', `${field} cannot contain both result and error`, { field });
  }
  if (result.receivedAt !== undefined && result.receivedAt !== null && !isNonEmptyString(result.receivedAt)) {
    throw new XRuntimeError('FLOW_RESUME_EVENT_INVALID', `${field}.receivedAt must be a non-empty string when provided`, { field });
  }

  return {
    requestId,
    result: result.result ?? null,
    error: result.error ?? null,
    errorCode: result.errorCode ?? null,
    receivedAt: result.receivedAt ?? null,
  };
}

function reasonFromError(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  if (typeof error === 'string') return error;
  if (isJsonSafe(error)) return JSON.stringify(error);
  return 'External error';
}

function isWaitTarget(target: TransitionTarget): boolean {
  return target.type === 'WAIT';
}

function extractString(value: unknown, key: string): string | null {
  return isRecord(value) && isNonEmptyString(value[key]) ? value[key] as string : null;
}

export function createProcessState(params: CreateProcessStateParams): ProcessState {
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

  const state: ProcessState = {
    processId: ensureNonEmptyStringState(params.processId, 'processId'),
    flowId: ensureNonEmptyStringState(flow.id, 'flow.id'),
    flowVersion: ensureNonEmptyStringState(flow.version, 'flow.version'),
    stateVersion: FLOW5_STATE_VERSION,
    traceMode,
    status: 'ACTIVE',
    current: {
      stepId: entryStep.id,
      type: entryStep.type,
      subtype: entryStep.subtype,
    },
    input: ensureJsonObject(params.input, 'input'),
    data: buildData(),
    steps: {},
    timeline: [],
    result: null,
    meta: ensureJsonObject(params.meta, 'meta'),
  };

  if (entryStep.type === 'WAIT') {
    state.status = 'WAITING';
    followTransition(state, {
      stepId: entryStep.id,
      type: 'WAIT',
      subtype: entryStep.subtype,
      title: entryStep.title,
      description: entryStep.description,
      sourceStepId: entryStep.sourceStepId,
    }, createdAt);
  }

  if (entryStep.type === 'TERMINAL') {
    const terminalEntry = entryStep as PreparedTerminalStep;
    if (terminalEntry.resultRef) {
      throw new XRuntimeError(
        'FLOW_RESULT_REF_NOT_RESOLVED',
        'TERMINAL with resultRef cannot be the entryStepId: dynamic terminal result must be produced by a prior process step',
        { stepId: entryStep.id, resultRef: terminalEntry.resultRef },
      );
    }
    finalizeTerminal(state, {
      stepId: entryStep.id,
      type: 'TERMINAL',
      subtype: entryStep.subtype,
      title: entryStep.title,
      description: entryStep.description,
      result: structuredClone(terminalEntry.result!),
    }, createdAt);
  }

  return state;
}

export function plan(flow: PreparedFlow, state: ProcessState): NormalizedStep {
  const preparedFlow = ensurePreparedFlowInput(flow, 'plan');
  ensureProcessStateInput(state, 'plan');
  const currentStep = ensureRuntimeAllowed(preparedFlow, state);

  if (currentStep.type === 'PROCESS') {
    const dataStep = currentStep as PreparedDataProcessStep;
    const next = buildTransitionTarget(preparedFlow, dataStep.nextStepId);
    const normalized: NormalizedDataProcessStepInternal = {
      id: dataStep.id,
      type: 'PROCESS',
      subtype: 'DATA',
      title: dataStep.title,
      description: dataStep.description,
      artefactId: dataStep.artefactId,
      nextStepId: dataStep.nextStepId,
      next,
    };
    return normalized;
  }

  if (currentStep.type === 'CONTROL') {
    const route = resolveRoute(preparedFlow, currentStep as PreparedControlStep, state);
    const next = buildTransitionTarget(preparedFlow, route.selectedNextStepId);
    const normalized: NormalizedRouteStepInternal = {
      id: currentStep.id,
      type: 'CONTROL',
      subtype: 'ROUTE',
      title: currentStep.title,
      description: currentStep.description,
      selectedNextStepId: route.selectedNextStepId,
      next,
      route,
    };
    return normalized;
  }

  if (currentStep.type === 'EFFECT') {
    const effectStep = currentStep as PreparedEffectStep;
    const normalized: NormalizedEffectStep = {
      id: effectStep.id,
      type: 'EFFECT',
      subtype: effectStep.subtype,
      title: effectStep.title,
      description: effectStep.description,
      operationId: effectStep.operationId,
      input: resolveInput(state, effectStep.inputRef),
    };
    if (effectStep.subtype === 'SUBFLOW') {
      const subflowStep = effectStep as PreparedEffectStep & { flowId: string; flowVersion: string };
      normalized.flowId = subflowStep.flowId;
      normalized.flowVersion = subflowStep.flowVersion;
    }
    return normalized;
  }

  if (currentStep.type === 'WAIT') {
    const waitStep = currentStep as PreparedWaitStep;
    const requestId = getLatestEffectRequestId(state, waitStep.sourceStepId);
    const sourceEffectStep = preparedFlow.stepsById[waitStep.sourceStepId] as PreparedEffectStep | undefined;
    const operationId = isNonEmptyString(sourceEffectStep?.operationId) ? sourceEffectStep!.operationId : undefined;
    const normalized: NormalizedWaitStep = {
      id: waitStep.id,
      type: 'WAIT',
      subtype: 'MESSAGE',
      title: waitStep.title,
      description: waitStep.description,
      sourceStepId: waitStep.sourceStepId,
    };
    if (requestId !== undefined) normalized.requestId = requestId;
    if (operationId !== undefined) normalized.operationId = operationId;
    return normalized;
  }

  const terminalPlan = currentStep as PreparedTerminalStep;
  if (terminalPlan.resultRef) {
    return {
      id: terminalPlan.id,
      type: 'TERMINAL',
      subtype: terminalPlan.subtype,
      title: terminalPlan.title,
      description: terminalPlan.description,
      resultRef: terminalPlan.resultRef,
    } satisfies NormalizedTerminalStep;
  }
  return {
    id: terminalPlan.id,
    type: 'TERMINAL',
    subtype: terminalPlan.subtype,
    title: terminalPlan.title,
    description: terminalPlan.description,
    result: structuredClone(terminalPlan.result!),
  } satisfies NormalizedTerminalStep;
}

export function reduce(step: NormalizedProcessStep | NormalizedControlStep | NormalizedTerminalStep, currentState: ProcessState, output: unknown): ProcessState {
  if (step == null || typeof step !== 'object' || typeof (step as any).id !== 'string') {
    throw new XRuntimeError('FLOW_RUNTIME_INPUT_INVALID', 'reduce: step must be a normalized step object from plan()', {});
  }
  if (currentState == null || typeof currentState !== 'object') {
    throw new XRuntimeError('FLOW_RUNTIME_INPUT_INVALID', 'reduce: state must be a ProcessState object', {});
  }

  if (step.type === 'TERMINAL') {
    if (currentState.current.stepId !== step.id) {
      throw new XRuntimeError('FLOW_STEP_MISMATCH', 'reduce(TERMINAL) step does not match current state', {
        stepId: step.id,
        currentStepId: currentState.current.stepId,
      });
    }
    if (currentState.current.type !== 'TERMINAL' || currentState.current.subtype !== step.subtype) {
      throw new XRuntimeError('FLOW_REDUCE_INVALID_TYPE', 'Current step must be TERMINAL', {
        stepId: step.id,
        currentStepType: currentState.current.type,
        currentStepSubtype: currentState.current.subtype,
      });
    }
    if (currentState.status === 'COMPLETE' || currentState.status === 'FAIL') {
      return currentState;
    }
    const terminalStep = step as NormalizedTerminalStep;
    const target: TransitionTarget = terminalStep.resultRef
      ? {
          stepId: step.id,
          type: 'TERMINAL',
          subtype: step.subtype,
          ...stepMetadata(terminalStep),
          resultRef: terminalStep.resultRef,
        }
      : {
          stepId: step.id,
          type: 'TERMINAL',
          subtype: step.subtype,
          ...stepMetadata(terminalStep),
          result: structuredClone(terminalStep.result!),
        };
    return finalizeTerminal(cloneState(currentState), target, now());
  }

  if (currentState.status === 'COMPLETE' || currentState.status === 'FAIL') {
    throw new XRuntimeError('FLOW_TERMINAL_MISUSED', 'reduce(...) cannot be called on an already-terminal process', {
      status: currentState.status,
    });
  }

  const expectedStepType = (step.type === 'CONTROL' ? 'CONTROL' : 'PROCESS') as PreparedStep['type'];
  ensureCurrentStep(currentState, step.id, expectedStepType, 'FLOW_REDUCE_INVALID_TYPE');
  if (currentState.current.subtype !== step.subtype) {
    throw new XRuntimeError('FLOW_STEP_MISMATCH', 'Step subtype does not match current state', {
      stepId: step.id,
      currentStepSubtype: currentState.current.subtype,
      stepSubtype: step.subtype,
    });
  }

  const internalStep = step as NormalizedDataProcessStepInternal | NormalizedRouteStepInternal;
  if (!('next' in internalStep) || !isRecord(internalStep.next) || !isNonEmptyString(internalStep.next.stepId)) {
    throw new XRuntimeError('FLOW_STATE_INVALID', 'reduce(...) requires a normalized step returned by plan(...)', {
      stepId: step.id,
    });
  }

  const nextState = cloneState(currentState);
  const at = now();

  if (step.type === 'PROCESS' && step.subtype === 'DATA') {
    if (!isRecord(output) || !Array.isArray((output as Record<string,unknown>)['writes'])) {
      throw new XRuntimeError('FLOW_DATA_OUTPUT_INVALID', 'reduce(PROCESS/DATA) requires DataflowOutput with writes array', {
        stepId: step.id,
      });
    }
    const dataOutput = output as unknown as DataflowOutput;
    if (dataOutput.trace !== undefined) {
      if (!Array.isArray(dataOutput.trace) || !isJsonSafe(dataOutput.trace)) {
        throw new XRuntimeError('FLOW_DATA_OUTPUT_INVALID', 'DataflowOutput.trace must be a JSON-safe array or absent', { stepId: step.id });
      }
    }
    const writes = dataOutput.writes.map((write) => {
      assertValidDataflowWrite(write, step.id);
      applyDataflowWrite(nextState, write);
      return structuredClone(write);
    });
    pushExecution(nextState, {
      stepId: step.id,
      type: 'PROCESS',
      subtype: 'DATA',
      ...stepMetadata(step),
    }, {
      executionId: nextExecutionId(nextState),
      attempt: (nextState.steps[step.id]?.executions.length ?? 0) + 1,
      status: 'COMPLETED',
      startedAt: at,
      finishedAt: at,
      failureCode: null,
      reason: null,
      nextStepId: internalStep.next.stepId,
      dataflow: {
        artefactId: (step as NormalizedDataProcessStep).artefactId,
        writes,
        ...(dataOutput.trace !== undefined ? { trace: structuredClone(dataOutput.trace) } : {}),
      },
    }, 'STEP_COMPLETED');
  } else if (step.type === 'CONTROL') {
    const routeStep = step as NormalizedRouteStepInternal;
    pushExecution(nextState, {
      stepId: step.id,
      type: 'CONTROL',
      subtype: 'ROUTE',
      ...stepMetadata(step),
    }, {
      executionId: nextExecutionId(nextState),
      attempt: (nextState.steps[step.id]?.executions.length ?? 0) + 1,
      status: 'COMPLETED',
      startedAt: at,
      finishedAt: at,
      failureCode: null,
      reason: null,
      nextStepId: internalStep.next.stepId,
      route: routeStep.route,
    }, 'STEP_COMPLETED');
  }

  return followTransition(nextState, internalStep.next, at);
}

export function apply(flow: PreparedFlow, currentState: ProcessState, stepId: string, effectResult: EffectResult): ProcessState {
  const preparedFlow = ensurePreparedFlowInput(flow, 'apply');
  ensureProcessStateInput(currentState, 'apply');
  const normalizedStepId = ensureStepIdInput(stepId, 'apply');
  const currentStep = ensureRuntimeAllowed(preparedFlow, currentState);
  ensureCurrentStep(currentState, normalizedStepId, 'EFFECT', 'FLOW_APPLY_INVALID_TYPE');
  if (currentStep.type !== 'EFFECT') {
    throw new XRuntimeError('FLOW_APPLY_INVALID_TYPE', 'apply(...) can be used only for EFFECT step', { stepId });
  }

  const effectStep = currentStep as PreparedEffectStep;
  const normalizedResult = normalizeExternalResult(effectResult, 'effectResult');
  const nextState = cloneState(currentState);
  const at = now();
  const timedOut = normalizedResult.errorCode === 'TIMEOUT';
  const failed = normalizedResult.error !== null || timedOut;
  const failureCode = failed ? normalizedResult.errorCode ?? 'ERROR' : null;
  const failureReason = failed ? reasonFromError(normalizedResult.error) ?? normalizedResult.errorCode ?? 'External failure' : null;
  const successTarget = buildTransitionTarget(preparedFlow, effectStep.nextStepId);
  const target = failed
    ? chooseFailureTarget(preparedFlow, currentStep.id, currentStep, normalizedResult.errorCode)
    : successTarget;
  const waitsForCallback = !failed && isWaitTarget(target);
  const status: StepExecutionStatus = failed ? 'FAILED' : waitsForCallback ? 'WAITING' : 'COMPLETED';
  const input = resolveInput(currentState, effectStep.inputRef);
  const common = {
    status,
    operationId: effectStep.operationId,
    requestId: normalizedResult.requestId,
    inputRef: effectStep.inputRef,
    ...(currentState.traceMode === 'verbose' ? { input: structuredClone(input) } : {}),
    accepted: waitsForCallback,
    result: waitsForCallback ? null : normalizedResult.result,
    error: normalizedResult.error,
    errorCode: normalizedResult.errorCode,
  };
  const record: StepExecutionRecord = {
    executionId: nextExecutionId(nextState),
    attempt: (nextState.steps[currentStep.id]?.executions.length ?? 0) + 1,
    status,
    startedAt: at,
    finishedAt: waitsForCallback ? null : at,
    failureCode,
    reason: failureReason,
    nextStepId: target.stepId,
  };
  if (effectStep.subtype === 'SUBFLOW') {
    const subflowStep = effectStep as PreparedEffectStep & { flowId: string; flowVersion: string };
    record.subflow = {
      ...common,
      flowId: subflowStep.flowId,
      flowVersion: subflowStep.flowVersion,
      childProcessId: extractString(normalizedResult.result, 'childProcessId') ?? extractString(normalizedResult.result, 'requestId') ?? (waitsForCallback ? normalizedResult.requestId : null),
    };
  } else {
    record.command = common;
  }
  pushExecution(nextState, effectStep, record, failed ? 'STEP_FAILED' : waitsForCallback ? 'STEP_WAITING' : 'STEP_COMPLETED');

  return followTransition(nextState, target, at);
}

export function resume(flow: PreparedFlow, currentState: ProcessState, stepId: string, resumeEvent: ResumeEvent): ProcessState {
  const preparedFlow = ensurePreparedFlowInput(flow, 'resume');
  ensureProcessStateInput(currentState, 'resume');
  const normalizedStepId = ensureStepIdInput(stepId, 'resume');
  const currentStep = ensureRuntimeAllowed(preparedFlow, currentState);
  ensureCurrentStep(currentState, normalizedStepId, 'WAIT', 'FLOW_RESUME_INVALID_TYPE');
  if (currentStep.type !== 'WAIT') {
    throw new XRuntimeError('FLOW_RESUME_INVALID_TYPE', 'resume(...) can be used only for WAIT step', { stepId });
  }

  const waitStep = currentStep as PreparedWaitStep;
  const normalizedResult = normalizeExternalResult(resumeEvent, 'resumeEvent');
  const nextState = cloneState(currentState);
  const at = normalizedResult.receivedAt ?? now();
  const timedOut = normalizedResult.errorCode === 'TIMEOUT';
  const failed = normalizedResult.error !== null || timedOut;
  const failureCode = failed ? normalizedResult.errorCode ?? 'ERROR' : null;
  const failureReason = failed ? reasonFromError(normalizedResult.error) ?? normalizedResult.errorCode ?? 'External failure' : null;
  const target = failed
    ? chooseFailureTarget(preparedFlow, currentStep.id, currentStep, normalizedResult.errorCode)
    : buildTransitionTarget(preparedFlow, currentStep.nextStepId);
  const sourceRuntime = nextState.steps[waitStep.sourceStepId];
  const sourceExecution = getLatestExecution(sourceRuntime);
  if (!sourceRuntime || !sourceExecution || (!sourceExecution.command && !sourceExecution.subflow)) {
    throw new XRuntimeError('FLOW_STEP_EXECUTION_INVALID', `WAIT source effect execution not found: ${waitStep.sourceStepId}`, {
      stepId,
      sourceStepId: waitStep.sourceStepId,
    });
  }
  const sourceRequestId = sourceExecution.command?.requestId ?? sourceExecution.subflow?.requestId;
  const waitRuntime = nextState.steps[waitStep.id];
  const waitExecution = getLatestExecution(waitRuntime);
  const waitRequestId = waitExecution?.wait?.requestId ?? null;
  if (isNonEmptyString(sourceRequestId) && normalizedResult.requestId !== sourceRequestId) {
    throw new XRuntimeError('FLOW_RESUME_REQUEST_ID_MISMATCH', 'resumeEvent.requestId does not match latest source EFFECT requestId', {
      stepId,
      sourceStepId: waitStep.sourceStepId,
      expectedRequestId: sourceRequestId,
      actualRequestId: normalizedResult.requestId,
    });
  }
  if (isNonEmptyString(waitRequestId) && normalizedResult.requestId !== waitRequestId) {
    throw new XRuntimeError('FLOW_RESUME_REQUEST_ID_MISMATCH', 'resumeEvent.requestId does not match WAIT execution requestId', {
      stepId,
      sourceStepId: waitStep.sourceStepId,
      expectedRequestId: waitRequestId,
      actualRequestId: normalizedResult.requestId,
    });
  }
  if (sourceExecution.command) {
    sourceExecution.command.status = failed ? 'FAILED' : 'COMPLETED';
    sourceExecution.command.result = normalizedResult.result;
    sourceExecution.command.error = normalizedResult.error;
    sourceExecution.command.errorCode = normalizedResult.errorCode;
    sourceExecution.status = failed ? 'FAILED' : 'COMPLETED';
  }
  if (sourceExecution.subflow) {
    sourceExecution.subflow.status = failed ? 'FAILED' : 'COMPLETED';
    sourceExecution.subflow.result = normalizedResult.result;
    sourceExecution.subflow.error = normalizedResult.error;
    sourceExecution.subflow.errorCode = normalizedResult.errorCode;
    sourceExecution.status = failed ? 'FAILED' : 'COMPLETED';
  }
  sourceExecution.finishedAt = at;
  sourceExecution.failureCode = failureCode;
  sourceExecution.reason = failureReason;
  sourceRuntime.status = sourceExecution.status;
  nextState.timeline.push({
    executionId: sourceExecution.executionId,
    stepId: waitStep.sourceStepId,
    kind: failed ? 'STEP_FAILED' : 'STEP_COMPLETED',
    status: sourceExecution.status,
    at,
  });

  if (waitExecution?.wait && waitExecution.status === 'WAITING') {
    waitExecution.status = failed ? 'FAILED' : 'COMPLETED';
    waitExecution.finishedAt = at;
    waitExecution.failureCode = failureCode;
    waitExecution.reason = failureReason;
    waitExecution.nextStepId = target.stepId;
    waitExecution.wait.requestId = normalizedResult.requestId;
    waitExecution.wait.resumedAt = at;
    waitExecution.wait.outcome = normalizedResult.errorCode === 'TIMEOUT' ? 'TIMEOUT' : failed ? 'ERROR' : 'SUCCESS';
    if (waitRuntime) waitRuntime.status = waitExecution.status;
    nextState.timeline.push({
      executionId: waitExecution.executionId,
      stepId: waitStep.id,
      kind: 'STEP_RESUMED',
      status: waitExecution.status,
      at,
    });
  } else {
    pushExecution(nextState, waitStep, {
      executionId: nextExecutionId(nextState),
      attempt: (nextState.steps[waitStep.id]?.executions.length ?? 0) + 1,
      status: failed ? 'FAILED' : 'COMPLETED',
      startedAt: at,
      finishedAt: at,
      failureCode,
      reason: failureReason,
      nextStepId: target.stepId,
      wait: {
        sourceStepId: waitStep.sourceStepId,
        requestId: normalizedResult.requestId,
        startedAt: null,
        resumedAt: at,
        outcome: normalizedResult.errorCode === 'TIMEOUT' ? 'TIMEOUT' : failed ? 'ERROR' : 'SUCCESS',
      },
    }, 'STEP_RESUMED');
  }

  return followTransition(nextState, target, at);
}
