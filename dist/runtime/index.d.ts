import type { PreparedFlow } from '../compiler/compiled.js';
import type { CreateProcessStateParams, EffectResult, NormalizedControlStep, NormalizedProcessStep, NormalizedStep, NormalizedTerminalStep, ProcessState, ResumeEvent } from './types.js';
export type { CreateProcessStateParams, EffectResult, FlowTraceMode, NormalizedEffectStep, NormalizedControlStep, NormalizedDataProcessStep, NormalizedProcessStep, NormalizedRouteStep, NormalizedStep, NormalizedTerminalStep, NormalizedWaitStep, ProcessDataContext, ProcessState, ResumeEvent, StepRuntimeState, TimelineEntry, WaitResult, } from './types.js';
export { FLOW5_STATE_VERSION } from './types.js';
export declare function createProcessState(params: CreateProcessStateParams): ProcessState;
export declare function plan(flow: PreparedFlow, state: ProcessState): NormalizedStep;
export declare function reduce(step: NormalizedProcessStep | NormalizedControlStep | NormalizedTerminalStep, currentState: ProcessState, output: unknown): ProcessState;
export declare function apply(flow: PreparedFlow, currentState: ProcessState, stepId: string, effectResult: EffectResult): ProcessState;
export declare function resume(flow: PreparedFlow, currentState: ProcessState, stepId: string, resumeEvent: ResumeEvent): ProcessState;
