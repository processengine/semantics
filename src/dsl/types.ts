import type { JsonObject, JsonValue } from '../utils/json.js';

export type StepId = string;
export type PathRef = string;
export type StepType = 'PROCESS' | 'CONTROL' | 'EFFECT' | 'WAIT' | 'TERMINAL';
export type ExecutableProcessSubtype = 'RULES' | 'MAPPINGS' | 'DECISIONS';
export type ControlStepSubtype = 'ROUTE' | 'SWITCH';
/** @deprecated Use ControlStepSubtype for routing steps */
export type RoutingProcessSubtype = ControlStepSubtype;
export type ProcessStepSubtype = ExecutableProcessSubtype;
export type EffectStepSubtype = 'COMMAND' | 'CALL' | 'SUBFLOW';
export type WaitStepSubtype = 'MESSAGE';
export type TerminalResultStatus = 'COMPLETE' | 'FAIL';

export interface InputRefObject {
  [key: string]: PathRef | InputRefObject;
}

export type InputRef = PathRef | InputRefObject;

export interface TerminalResult {
  status: TerminalResultStatus;
  outcome: string;
  [key: string]: JsonValue;
}

export interface FlowDefinition {
  id: string;
  version: string;
  entryStepId: StepId;
  title?: string;
  description?: string;
  metadata?: JsonObject;
  steps: Record<StepId, StepDefinition>;
}

export interface StepDefinitionBase {
  id: StepId;
  type: StepType;
  subtype: string;
  title?: string;
  description?: string;
  metadata?: JsonObject;
}

export interface StepContract {
  input: { ref: InputRef; fields?: JsonObject };
  output: { ref: PathRef; fields?: JsonObject };
}

export interface ExecutableProcessStepDefinition extends StepDefinitionBase {
  type: 'PROCESS';
  subtype: ExecutableProcessSubtype;
  artefactId: string;
  contract: StepContract;
  nextStepId: StepId;
}

export interface RouteStepDefinition extends StepDefinitionBase {
  type: 'CONTROL';
  subtype: 'ROUTE';
  factRef: PathRef;
  cases: Record<string, StepId>;
  defaultNextStepId: StepId;
}

export interface SwitchStepDefinition extends StepDefinitionBase {
  type: 'CONTROL';
  subtype: 'SWITCH';
  decisionSetId: string;
  cases: Record<string, StepId>;
  defaultNextStepId: StepId;
}

export interface CommandCallEffectStepDefinition extends StepDefinitionBase {
  type: 'EFFECT';
  subtype: 'COMMAND' | 'CALL';
  operationId: string;
  inputRef: InputRef;
  nextStepId: StepId;
  onErrorStepId?: StepId;
  onTimeoutStepId?: StepId;
}

export interface SubflowEffectStepDefinition extends StepDefinitionBase {
  type: 'EFFECT';
  subtype: 'SUBFLOW';
  operationId: string;
  flowId: string;
  flowVersion: string;
  inputRef: InputRef;
  nextStepId: StepId;
  onErrorStepId?: StepId;
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
  result: TerminalResult;
}

export type ProcessStepDefinition = ExecutableProcessStepDefinition;

export type ControlStepDefinition =
  | RouteStepDefinition
  | SwitchStepDefinition;

export type StepDefinition =
  | ProcessStepDefinition
  | ControlStepDefinition
  | EffectStepDefinition
  | WaitStepDefinition
  | TerminalStepDefinition;
