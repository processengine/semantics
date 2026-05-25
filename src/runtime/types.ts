import type { PreparedFlow } from '../compiler/compiled.js';
import type {
  EffectStepSubtype,
  StepId,
  StepType,
  TerminalResult,
  TerminalResultStatus,
  WaitStepSubtype,
} from '../dsl/types.js';
import type { JsonObject, JsonValue } from '../utils/json.js';

export const FLOW5_STATE_VERSION = 'flow5-state-v2' as const;

export type ProcessStatus = 'ACTIVE' | 'WAITING' | 'COMPLETE' | 'FAIL';
export type StepExecutionStatus = 'PENDING' | 'WAITING' | 'COMPLETED' | 'FAILED';
export type TimelineKind = 'STEP_COMPLETED' | 'STEP_FAILED' | 'STEP_WAITING' | 'STEP_RESUMED';
export type FlowTraceMode = 'off' | 'basic' | 'verbose';

export interface CurrentStepRef {
  stepId: StepId;
  type: StepType;
  subtype: string;
}

export interface ProcessDataContext {
  payloads: Record<string, unknown>;
  facts: Record<string, unknown>;
  decisions: Record<string, unknown>;
  checks: Record<string, unknown>;
  results: Record<string, unknown>;
}

export interface DataflowWrite {
  ref: string;
  value: unknown;
  itemId: string;
}

export interface DataflowOutput {
  writes: DataflowWrite[];
  trace?: unknown[];
}

export interface StepDataflowExecution {
  artefactId: string;
  writes: DataflowWrite[];
  items?: unknown[];
  trace?: unknown[];
}

export interface StepRouteExecution {
  ref: string;
  resolvedValue: JsonValue;
  selectedCase: string | null;
  selectedNextStepId: StepId;
  fallback: boolean;
  fallbackReason: string | null;
}

export interface StepCommandExecution {
  status: StepExecutionStatus;
  operationId: string;
  requestId: string;
  inputRef: string;
  input?: unknown;
  accepted: boolean;
  result: unknown | null;
  error: unknown | null;
  errorCode: string | null;
}

export interface StepSubflowExecution {
  status: StepExecutionStatus;
  operationId: string;
  flowId: string;
  flowVersion: string;
  childProcessId: string | null;
  requestId: string;
  inputRef: string;
  input?: unknown;
  accepted: boolean;
  result: unknown | null;
  error: unknown | null;
  errorCode: string | null;
}

export interface StepWaitExecution {
  sourceStepId: StepId;
  requestId: string | null;
  startedAt: string | null;
  resumedAt: string | null;
  outcome: 'WAITING' | 'SUCCESS' | 'ERROR' | 'TIMEOUT';
}

export interface StepTerminalExecution {
  mode: 'static' | 'resultRef';
  resultRef: string | null;
  result: TerminalResult;
}

export interface StepExecutionRecord {
  executionId: string;
  attempt: number;
  status: StepExecutionStatus;
  startedAt: string;
  finishedAt: string | null;
  failureCode: string | null;
  reason: string | null;
  nextStepId?: StepId;
  dataflow?: StepDataflowExecution;
  route?: StepRouteExecution;
  command?: StepCommandExecution;
  subflow?: StepSubflowExecution;
  wait?: StepWaitExecution;
  terminal?: StepTerminalExecution;
}

export interface StepRuntimeState {
  stepId: StepId;
  type: StepType;
  subtype: string;
  title?: string;
  description?: string;
  status: StepExecutionStatus;
  latestExecutionId: string | null;
  executions: StepExecutionRecord[];
}

export interface TimelineEntry {
  executionId: string;
  stepId: StepId;
  kind: TimelineKind;
  status: StepExecutionStatus;
  at: string;
}

export interface ProcessState {
  processId: string;
  flowId: string;
  flowVersion: string;
  stateVersion: typeof FLOW5_STATE_VERSION;
  traceMode: FlowTraceMode;
  status: ProcessStatus;
  current: CurrentStepRef;
  input: Record<string, unknown>;
  data: ProcessDataContext;
  steps: Record<string, StepRuntimeState>;
  timeline: TimelineEntry[];
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
  subtype: 'DATA';
  title?: string;
  description?: string;
}

export interface ControlTransitionTarget {
  stepId: StepId;
  type: 'CONTROL';
  subtype: 'ROUTE';
  title?: string;
  description?: string;
}

export interface EffectTransitionTarget {
  stepId: StepId;
  type: 'EFFECT';
  subtype: EffectStepSubtype;
  title?: string;
  description?: string;
}

export interface WaitTransitionTarget {
  stepId: StepId;
  type: 'WAIT';
  subtype: WaitStepSubtype;
  sourceStepId: StepId;
  title?: string;
  description?: string;
}

export interface TerminalTransitionTarget {
  stepId: StepId;
  type: 'TERMINAL';
  subtype: TerminalResultStatus;
  result?: TerminalResult;
  resultRef?: string;
  title?: string;
  description?: string;
}

export type TransitionTarget =
  | ProcessTransitionTarget
  | ControlTransitionTarget
  | EffectTransitionTarget
  | WaitTransitionTarget
  | TerminalTransitionTarget;

export interface NormalizedDataProcessStep {
  id: StepId;
  type: 'PROCESS';
  subtype: 'DATA';
  title?: string;
  description?: string;
  artefactId: string;
  nextStepId: StepId;
}

export interface NormalizedRouteStep {
  id: StepId;
  type: 'CONTROL';
  subtype: 'ROUTE';
  title?: string;
  description?: string;
  selectedNextStepId: StepId;
}

export interface NormalizedEffectStep {
  id: StepId;
  type: 'EFFECT';
  subtype: EffectStepSubtype;
  title?: string;
  description?: string;
  operationId: string;
  input: unknown;
  flowId?: string;
  flowVersion?: string;
}

export interface NormalizedWaitStep {
  id: StepId;
  type: 'WAIT';
  subtype: WaitStepSubtype;
  title?: string;
  description?: string;
  sourceStepId: StepId;
  requestId?: string;
  operationId?: string;
}

export interface NormalizedTerminalStep {
  id: StepId;
  type: 'TERMINAL';
  subtype: TerminalResultStatus;
  title?: string;
  description?: string;
  result?: TerminalResult;
  resultRef?: string;
}

export type NormalizedProcessStep = NormalizedDataProcessStep;
export type NormalizedControlStep = NormalizedRouteStep;
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
  receivedAt?: string;
}

export type EffectResult = ExternalResult;
export type ResumeEvent = ExternalResult;
export type WaitResult = ResumeEvent;
