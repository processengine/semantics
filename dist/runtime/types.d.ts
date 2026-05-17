import type { PreparedFlow } from '../compiler/compiled.js';
import type { EffectStepSubtype, StepId, StepType, TerminalResult, TerminalResultStatus, WaitStepSubtype } from '../dsl/types.js';
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
export interface ProcessDataContext {
    payloads: Record<string, unknown>;
    facts: Record<string, unknown>;
    decisions: Record<string, unknown>;
    checks: Record<string, unknown>;
    results: Record<string, unknown>;
}
export interface ProcessContext {
    input: Record<string, unknown>;
    data: ProcessDataContext;
    effects: Record<string, unknown>;
    steps: Record<string, StepRuntimeState>;
}
export interface ProcessHistoryEntry {
    at: string;
    kind: 'STEP_COMPLETED' | 'STEP_FAILED' | 'STEP_WAITING' | 'STEP_RESUMED';
    stepId: StepId;
    details?: Record<string, unknown>;
}
export interface ProcessState {
    processId: string;
    flowId: string;
    flowVersion: string;
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
    subtype: 'DATA';
}
export interface ControlTransitionTarget {
    stepId: StepId;
    type: 'CONTROL';
    subtype: 'ROUTE';
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
    result?: TerminalResult;
    resultRef?: string;
}
export type TransitionTarget = ProcessTransitionTarget | ControlTransitionTarget | EffectTransitionTarget | WaitTransitionTarget | TerminalTransitionTarget;
export interface NormalizedDataProcessStep {
    id: StepId;
    type: 'PROCESS';
    subtype: 'DATA';
    artefactId: string;
    nextStepId: StepId;
}
export interface NormalizedRouteStep {
    id: StepId;
    type: 'CONTROL';
    subtype: 'ROUTE';
    selectedNextStepId: StepId;
}
export interface NormalizedEffectStep {
    id: StepId;
    type: 'EFFECT';
    subtype: EffectStepSubtype;
    operationId: string;
    input: unknown;
    flowId?: string;
    flowVersion?: string;
}
export interface NormalizedWaitStep {
    id: StepId;
    type: 'WAIT';
    subtype: WaitStepSubtype;
    sourceStepId: StepId;
    requestId?: string;
    operationId?: string;
}
export interface NormalizedTerminalStep {
    id: StepId;
    type: 'TERMINAL';
    subtype: TerminalResultStatus;
    result?: TerminalResult;
    resultRef?: string;
}
export type NormalizedProcessStep = NormalizedDataProcessStep;
export type NormalizedControlStep = NormalizedRouteStep;
export type NormalizedStep = NormalizedProcessStep | NormalizedControlStep | NormalizedEffectStep | NormalizedWaitStep | NormalizedTerminalStep;
export interface ExternalResult {
    requestId: string;
    result?: unknown;
    error?: unknown | null;
    errorCode?: string | null;
}
export type EffectResult = ExternalResult;
export type WaitResult = ExternalResult;
export interface DataflowWrite {
    ref: string;
    value: unknown;
    itemId: string;
}
export interface DataflowOutput {
    writes: DataflowWrite[];
    trace?: unknown[];
}
