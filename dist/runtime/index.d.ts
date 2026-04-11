import type { PreparedFlow } from '../compiler/compiled.js';
import type { CreateProcessStateParams, EffectResult, NormalizedControlStep, NormalizedProcessStep, NormalizedStep, ProcessState, WaitResult } from './types.js';
export type { CreateProcessStateParams, EffectResult, FlowTraceMode, NormalizedEffectStep, NormalizedControlStep, NormalizedExecutableProcessStep, NormalizedProcessStep, NormalizedRouteStep, NormalizedStep, NormalizedSwitchStep, NormalizedTerminalStep, NormalizedWaitStep, ProcessContext, ProcessHistoryEntry, ProcessState, StepRuntimeState, WaitResult, } from './types.js';
export declare function createProcessState(params: CreateProcessStateParams): ProcessState;
export declare function plan(flow: PreparedFlow, state: ProcessState): NormalizedStep;
export declare function reduce(step: NormalizedProcessStep | NormalizedControlStep, currentState: ProcessState, output: unknown): ProcessState;
export declare function apply(flow: PreparedFlow, currentState: ProcessState, stepId: string, effectResult: EffectResult): ProcessState;
export declare function resume(flow: PreparedFlow, currentState: ProcessState, stepId: string, waitResult: WaitResult): ProcessState;
