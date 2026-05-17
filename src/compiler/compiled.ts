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

// Flow 5 prepared step types
export type PreparedDataProcessStep = DataProcessStepDefinition;
export type PreparedRouteStep = RouteStepDefinition;
export type PreparedProcessStep = PreparedDataProcessStep;
export type PreparedControlStep = PreparedRouteStep;
export type PreparedEffectStep = EffectStepDefinition;
export type PreparedWaitStep = WaitStepDefinition;
export type PreparedTerminalStep = TerminalStepDefinition;
export type PreparedStep =
  | PreparedProcessStep
  | PreparedControlStep
  | PreparedEffectStep
  | PreparedWaitStep
  | PreparedTerminalStep;

export function normalizeSteps(steps: Record<StepId, StepDefinition>): Record<StepId, PreparedStep> {
  const normalized: Record<StepId, PreparedStep> = {};
  for (const [stepId, step] of Object.entries(steps)) {
    normalized[stepId] = structuredClone(step) as PreparedStep;
  }
  return normalized;
}

export function createPreparedFlow(flow: FlowDefinition, _options?: unknown): PreparedFlow {
  const prepared: PreparedFlowInternal = {
    id: flow.id,
    version: flow.version,
    entryStepId: flow.entryStepId,
    orderedStepIds: Object.keys(flow.steps),
    stepsById: normalizeSteps(flow.steps),
    ...(flow.metadata !== undefined ? { metadata: structuredClone(flow.metadata) } : {}),
    ...(flow.title !== undefined ? { title: flow.title } : {}),
    ...(flow.description !== undefined ? { description: flow.description } : {}),
  };
  return deepFreeze(prepared) as PreparedFlow;
}

export function asPreparedFlowInternal(flow: PreparedFlow): PreparedFlowInternal {
  return flow as PreparedFlowInternal;
}

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    if (nested !== null && typeof nested === 'object') deepFreeze(nested);
  }
  return value;
}
