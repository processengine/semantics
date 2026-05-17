import type { JsonObject, JsonValue } from '../utils/json.js';
export type StepId = string;
export type PathRef = string;
export type StepType = 'PROCESS' | 'CONTROL' | 'EFFECT' | 'WAIT' | 'TERMINAL';
export type ProcessStepSubtype = 'DATA';
export type ControlStepSubtype = 'ROUTE';
export type EffectStepSubtype = 'COMMAND' | 'CALL' | 'SUBFLOW';
export type WaitStepSubtype = 'MESSAGE';
export type TerminalResultStatus = 'COMPLETE' | 'FAIL';
export interface TerminalResult {
    status: TerminalResultStatus;
    outcome: string;
    [key: string]: JsonValue;
}
export interface FlowDefinition {
    id: string;
    version: string;
    title: string;
    description: string;
    entryStepId: StepId;
    steps: Record<StepId, StepDefinition>;
    metadata?: JsonObject;
}
export interface StepDefinitionBase {
    id: StepId;
    type: StepType;
    subtype: string;
    title: string;
    description: string;
    metadata?: JsonObject;
}
export interface DataProcessStepDefinition extends StepDefinitionBase {
    type: 'PROCESS';
    subtype: 'DATA';
    artefactId: string;
    nextStepId: StepId;
}
export type ProcessStepDefinition = DataProcessStepDefinition;
export interface RouteStepDefinition extends StepDefinitionBase {
    type: 'CONTROL';
    subtype: 'ROUTE';
    ref: PathRef;
    cases: Record<string, StepId>;
    defaultNextStepId: StepId;
}
export type ControlStepDefinition = RouteStepDefinition;
export interface CommandCallEffectStepDefinition extends StepDefinitionBase {
    type: 'EFFECT';
    subtype: 'COMMAND' | 'CALL';
    operationId: string;
    inputRef: PathRef;
    nextStepId: StepId;
    onErrorStepId: StepId;
    onTimeoutStepId?: StepId;
}
export interface SubflowEffectStepDefinition extends StepDefinitionBase {
    type: 'EFFECT';
    subtype: 'SUBFLOW';
    operationId: string;
    flowId: string;
    flowVersion: string;
    inputRef: PathRef;
    nextStepId: StepId;
    onErrorStepId: StepId;
    onTimeoutStepId?: StepId;
}
export type EffectStepDefinition = CommandCallEffectStepDefinition | SubflowEffectStepDefinition;
export interface WaitStepDefinition extends StepDefinitionBase {
    type: 'WAIT';
    subtype: 'MESSAGE';
    sourceStepId: StepId;
    nextStepId: StepId;
    onErrorStepId: StepId;
    onTimeoutStepId: StepId;
}
export interface TerminalStepDefinition extends StepDefinitionBase {
    type: 'TERMINAL';
    subtype: TerminalResultStatus;
    result?: TerminalResult;
    resultRef?: PathRef;
}
export type StepDefinition = DataProcessStepDefinition | RouteStepDefinition | EffectStepDefinition | WaitStepDefinition | TerminalStepDefinition;
