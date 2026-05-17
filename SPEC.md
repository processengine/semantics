# @processengine/semantics v2 — Flow 5 Specification

## What this document defines normatively

This document is the normative specification for `@processengine/semantics v2`.

It defines:
- Flow 5 step taxonomy and DSL contract
- Process state contract (ProcessContext, ProcessState)
- Public API: validateFlow, prepareFlow, createProcessState, plan, reduce, apply, resume
- Runtime semantics: plan, reduce, apply, resume behaviour per step type
- Error codes and validation diagnostic codes

## Flow 5 step taxonomy

| Step | Subtype(s) | Purpose |
|------|-----------|---------|
| PROCESS | DATA | Synchronous data processing via dataflow artifact |
| CONTROL | ROUTE | Route by any scalar value from state |
| EFFECT | COMMAND, CALL, SUBFLOW | Async external call or subflow |
| WAIT | MESSAGE | Wait for EFFECT response |
| TERMINAL | COMPLETE, FAIL | End the process |

**Removed in Flow 5 (not supported):**
- `PROCESS/RULES`, `PROCESS/MAPPINGS`, `PROCESS/DECISIONS` → replaced by `PROCESS/DATA`
- `CONTROL/SWITCH`, `factRef` → replaced by `CONTROL/ROUTE` with `ref`

## ProcessContext (Flow 5)

```ts
interface ProcessContext {
  input: Record<string, unknown>;       // process entry input
  data: {
    payloads:  Record<string, unknown>; // intermediate payloads between systems
    facts:     Record<string, unknown>; // decision-ready facts
    decisions: Record<string, unknown>; // decision outcomes from dataflows
    checks:    Record<string, unknown>; // rule check results
    results:   Record<string, unknown>; // terminal results
  };
  effects: Record<string, unknown>;     // effect responses (EFFECT/WAIT)
  steps:   Record<string, StepRuntimeState>; // trace only
}
```

**Removed namespaces:** `context.facts`, `context.decisions`, `context.checks` — use `context.data.*` instead.

## ProcessState (Flow 5)

```ts
interface ProcessState {
  processId:        string;
  flowId:           string;   // was 'id' in v1
  flowVersion:      string;   // was 'version' in v1
  status:           'ACTIVE' | 'WAITING' | 'COMPLETE' | 'FAIL';
  currentStepId:    string;
  currentStepType:  string;
  currentStepSubtype: string;
  context:          ProcessContext;
  history:          ProcessHistoryEntry[];
  result:           TerminalResult | null;
  meta:             JsonObject;
  traceMode:        'off' | 'basic' | 'verbose';
}
```

## Step definitions

### PROCESS/DATA

```ts
{
  id:          string;   // required
  type:        'PROCESS';
  subtype:     'DATA';
  title:       string;   // required
  description: string;   // required
  artefactId:  string;   // required — dataflow artifact ID
  nextStepId:  string;   // required
  metadata?:   JsonObject;
}
```

**Forbidden fields:** `contract`, `inputRef`, `outputRef`, `cases`, `onErrorStepId`, `onTimeoutStepId`.

`PROCESS/DATA` does not own data contracts. The dataflow artifact owns input/output.

### CONTROL/ROUTE

```ts
{
  id:              string;
  type:            'CONTROL';
  subtype:         'ROUTE';
  title:           string;
  description:     string;
  ref:             string;             // PathRef to scalar in state
  cases:           Record<string, string>; // value → nextStepId
  defaultNextStepId: string;
  metadata?:       JsonObject;
}
```

`ref` behaviour:
- Missing in state → `FLOW_ROUTE_REF_NOT_RESOLVED` (runtime error)
- Resolves to object/array → `FLOW_ROUTE_REF_NOT_SCALAR` (runtime error)
- No matching case → `defaultNextStepId`

### EFFECT (COMMAND, CALL, SUBFLOW)

```ts
{
  id:              string;
  type:            'EFFECT';
  subtype:         'COMMAND' | 'CALL' | 'SUBFLOW';
  title:           string;
  description:     string;
  operationId:     string;   // required
  inputRef:        string;   // required — string PathRef only
  nextStepId:      string;   // required
  onErrorStepId:   string;   // required — external failure is a lifecycle outcome
  onTimeoutStepId?: string;
  // SUBFLOW only:
  flowId?:         string;
  flowVersion?:    string;
  metadata?:       JsonObject;
}
```

### WAIT/MESSAGE

```ts
{
  id:              string;
  type:            'WAIT';
  subtype:         'MESSAGE';
  title:           string;
  description:     string;
  sourceStepId:    string;   // required — must reference an EFFECT step
  nextStepId:      string;
  onErrorStepId:   string;
  onTimeoutStepId: string;
  metadata?:       JsonObject;
}
```

### TERMINAL (COMPLETE, FAIL)

```ts
{
  id:          string;
  type:        'TERMINAL';
  subtype:     'COMPLETE' | 'FAIL';
  title:       string;
  description: string;
  // exactly one of result or resultRef:
  result?:     { status: 'COMPLETE'|'FAIL'; outcome: string; [k: string]: JsonValue };
  resultRef?:  string; // must start with $.context.data.results.
  metadata?:   JsonObject;
}
```

`result.status` must match `subtype`. `resultRef` must point into `$.context.data.results.*`.

## Public API

```ts
validateFlow(source, options?) → ValidationResult
prepareFlow(source, options?)  → PreparedFlow        // throws XCompileError if invalid
createProcessState(params)     → ProcessState
plan(flow, state)              → NormalizedStep
reduce(step, state, output)    → ProcessState
apply(flow, state, stepId, effectResult) → ProcessState
resume(flow, state, stepId, waitResult)  → ProcessState
```

## Runtime semantics

### plan

Returns the normalized step for the current state. Does not mutate state.

For `PROCESS/DATA`:
```ts
{ id, type: 'PROCESS', subtype: 'DATA', artefactId, nextStepId }
// No input — orchestrator does not see dataflow internals
```

For `CONTROL/ROUTE`:
```ts
{ id, type: 'CONTROL', subtype: 'ROUTE', selectedNextStepId }
// Resolves ref and selects case internally
```

### reduce

```
reduce(PROCESS/DATA, state, DataflowOutput) → ProcessState
  - DataflowOutput.writes[] applied atomically to context.data.*
  - Each write.ref must start with $.context.data.
  - Each write.value must be JSON-safe
  - Advances to nextStepId

reduce(CONTROL/ROUTE, state, null) → ProcessState
  - Advances to selectedNextStepId

reduce(TERMINAL, state, null) → ProcessState
  - If static result: sets state.status, state.result
  - If resultRef: resolves from context.data.results.*, validates shape, sets state.status, state.result
  - Returns finalized terminal state

```

## Validation diagnostic codes

Full list in `src/errors/types.ts`. Key codes:

| Code | Trigger |
|------|---------|
| `FLOW_INVALID_SUBTYPE` | PROCESS/RULES, PROCESS/MAPPINGS, PROCESS/DECISIONS, CONTROL/SWITCH |
| `FLOW_DATA_STEP_FORBIDDEN_FIELD` | contract/inputRef/cases/onErrorStepId on DATA step |
| `FLOW_ROUTE_FACTREF_REMOVED` | factRef on ROUTE step |
| `FLOW_EFFECT_ON_ERROR_MISSING` | EFFECT without onErrorStepId |
| `FLOW_TRANSITION_NOT_FOUND` | nextStepId/case/default referencing non-existent step |
| `FLOW_WAIT_SOURCE_NOT_EFFECT` | WAIT.sourceStepId not an EFFECT step |
| `FLOW_TERMINAL_RESULT_STATUS_MISMATCH` | result.status ≠ TERMINAL subtype |
| `FLOW_TERMINAL_RESULTREF_INVALID` | resultRef not in $.context.data.results.* |

## Runtime error codes

| Code | Trigger |
|------|---------|
| `FLOW_ROUTE_REF_NOT_RESOLVED` | ROUTE ref path missing in state |
| `FLOW_ROUTE_REF_NOT_SCALAR` | ROUTE ref resolves to object/array |
| `FLOW_DATA_OUTPUT_INVALID` | DataflowOutput not { writes: array } |
| `FLOW_DATA_WRITE_FORBIDDEN_PATH` | write.ref not in $.context.data.* |
| `FLOW_DATA_WRITE_NOT_JSON_SAFE` | write.value not JSON-safe |
| `FLOW_TERMINAL_MISUSED` | runtime method called on already-terminal state |
| `FLOW_RESULT_REF_NOT_RESOLVED` | resultRef path missing in state |
| `FLOW_RESULT_REF_SHAPE_INVALID` | resultRef value shape invalid |
