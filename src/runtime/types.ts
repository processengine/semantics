import type { PreparedFlow } from '../compiler/compiled.js';
import type {
  EffectStepSubtype,
  ControlStepSubtype,
  ExecutableProcessSubtype,
  StepId,
  StepType,
  TerminalResult,
  TerminalResultStatus,
  WaitStepSubtype,
} from '../dsl/types.js';
import type { JsonObject } from '../utils/json.js';

export type ProcessStatus = 'ACTIVE' | 'WAITING' | 'COMPLETE' | 'FAIL';
export type StepTraceStatus = 'COMPLETED' | 'WAITING' | 'FAILED';
export type FlowTraceMode = 'off' | 'basic' | 'verbose';

export interface StepRuntimeState {
  status: StepTraceStatus;
  startedAt: string;
  finishedAt: string | null;
  failureCode: string | null;
  reason: string | null;
  selectedNextStepId?: StepId;
  requestId?: string;
}

export interface ProcessContext {
  input: Record<string, unknown>;
  checks: Record<string, unknown>;
  facts: Record<string, unknown>;
  decisions: Record<string, unknown>;
  steps: Record<string, StepRuntimeState>;
  effects: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ProcessHistoryEntry {
  at: string;
  kind: 'STEP_COMPLETED' | 'STEP_FAILED' | 'STEP_WAITING' | 'STEP_RESUMED';
  stepId: StepId;
  details?: Record<string, unknown>;
}

export interface ProcessState {
  processId: string;
  id: string;
  version: string;
  traceMode: FlowTraceMode;
  status: ProcessStatus;
  currentStepId: StepId;
  currentStepType: StepType;
  currentStepSubtype: string;
  context: ProcessContext;
  history: ProcessHistoryEntry[];
  result: TerminalResult | null;
  meta: JsonObject;
}

export interface CreateProcessStateParams {
  flow: PreparedFlow;
  processId: string;
  input?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  trace?: FlowTraceMode;
}

export interface ProcessTransitionTarget {
  stepId: StepId;
  type: 'PROCESS';
  subtype: ExecutableProcessSubtype;
}

export interface ControlTransitionTarget {
  stepId: StepId;
  type: 'CONTROL';
  subtype: ControlStepSubtype;
}

export interface EffectTransitionTarget {
  stepId: StepId;
  type: 'EFFECT';
  subtype: EffectStepSubtype;
}

export interface WaitTransitionTarget {
  stepId: StepId;
  type: 'WAIT';
  subtype: WaitStepSubtype;
  sourceStepId: StepId;
}

export interface TerminalTransitionTarget {
  stepId: StepId;
  type: 'TERMINAL';
  subtype: TerminalResultStatus;
  result: TerminalResult;
}

export type TransitionTarget =
  | ProcessTransitionTarget
  | ControlTransitionTarget
  | EffectTransitionTarget
  | WaitTransitionTarget
  | TerminalTransitionTarget;

export interface NormalizedExecutableProcessStep {
  id: StepId;
  type: 'PROCESS';
  subtype: ExecutableProcessSubtype;
  artefactId: string;
  input: unknown;
}

export interface NormalizedRouteStep {
  id: StepId;
  type: 'CONTROL';
  subtype: 'ROUTE';
  selectedNextStepId: StepId;
}

export interface NormalizedSwitchStep {
  id: StepId;
  type: 'CONTROL';
  subtype: 'SWITCH';
  selectedNextStepId: StepId;
}

export interface NormalizedEffectStep {
  id: StepId;
  type: 'EFFECT';
  subtype: EffectStepSubtype;
  operationId: string;
  input: unknown;
  /** Present only when subtype is 'SUBFLOW' */
  flowId?: string;
  /** Present only when subtype is 'SUBFLOW' */
  flowVersion?: string;
}

export interface NormalizedWaitStep {
  id: StepId;
  type: 'WAIT';
  subtype: WaitStepSubtype;
  sourceStepId: StepId;
  requestId?: string;
  /** operationId of the source EFFECT step. Materialized by plan(...) for Host consumer dispatch. */
  operationId?: string;
}

export interface NormalizedTerminalStep {
  id: StepId;
  type: 'TERMINAL';
  subtype: TerminalResultStatus;
  result: TerminalResult;
}

export type NormalizedProcessStep = NormalizedExecutableProcessStep;
export type NormalizedControlStep = NormalizedRouteStep | NormalizedSwitchStep;
export type NormalizedStep =
  | NormalizedProcessStep
  | NormalizedControlStep
  | NormalizedEffectStep
  | NormalizedWaitStep
  | NormalizedTerminalStep;

export interface ExternalResult {
  requestId: string;
  result?: unknown;
  error?: unknown | null;
  errorCode?: string | null;
}

export type EffectResult = ExternalResult;
export type WaitResult = ExternalResult;
