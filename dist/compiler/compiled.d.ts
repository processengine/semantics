import type { DataProcessStepDefinition, EffectStepDefinition, FlowDefinition, RouteStepDefinition, StepDefinition, StepId, TerminalStepDefinition, WaitStepDefinition } from '../dsl/types.js';
import type { JsonObject } from '../utils/json.js';
export interface PreparedFlow {
    readonly id: string;
    readonly version: string;
}
export interface PreparedFlowInternal extends PreparedFlow {
    readonly entryStepId: StepId;
    readonly orderedStepIds: StepId[];
    readonly stepsById: Record<StepId, PreparedStep>;
    readonly metadata?: JsonObject;
    readonly title?: string;
    readonly description?: string;
}
export type PreparedDataProcessStep = DataProcessStepDefinition;
export type PreparedRouteStep = RouteStepDefinition;
export type PreparedProcessStep = PreparedDataProcessStep;
export type PreparedControlStep = PreparedRouteStep;
export type PreparedEffectStep = EffectStepDefinition;
export type PreparedWaitStep = WaitStepDefinition;
export type PreparedTerminalStep = TerminalStepDefinition;
export type PreparedStep = PreparedProcessStep | PreparedControlStep | PreparedEffectStep | PreparedWaitStep | PreparedTerminalStep;
export declare function normalizeSteps(steps: Record<StepId, StepDefinition>): Record<StepId, PreparedStep>;
export declare function createPreparedFlow(flow: FlowDefinition, _options?: unknown): PreparedFlow;
export declare function asPreparedFlowInternal(flow: PreparedFlow): PreparedFlowInternal;
export declare function deepFreeze<T>(value: T): T;
