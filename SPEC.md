# @processengine/semantics v3 — Flow 5 State v2 Specification

This document is the normative contract for `@processengine/semantics v3`.

It defines Flow 5 source artifacts, the State v2 runtime shape, public lifecycle APIs, runtime transitions, and stable diagnostic codes.

## Step Taxonomy

| Step | Subtype(s) | Purpose |
|------|------------|---------|
| `PROCESS` | `DATA` | Synchronous business data assessment through a dataflow artifact |
| `CONTROL` | `ROUTE` | Route by a scalar value from `$.data.*` |
| `EFFECT` | `COMMAND`, `CALL`, `SUBFLOW` | External command/call or child process launch |
| `WAIT` | `MESSAGE` | Wait for an asynchronous result of an EFFECT step |
| `TERMINAL` | `COMPLETE`, `FAIL` | Finish the process |

Removed from Flow 5: `PROCESS/RULES`, `PROCESS/MAPPINGS`, `PROCESS/DECISIONS`, `CONTROL/SWITCH`, `CONTROL/ROUTE.factRef`.

## State v2

```ts
interface ProcessState {
  processId: string;
  flowId: string;
  flowVersion: string;
  stateVersion: 'flow5-state-v2';
  traceMode: 'off' | 'basic' | 'verbose';
  status: 'ACTIVE' | 'WAITING' | 'COMPLETE' | 'FAIL';
  current: {
    stepId: string;
    type: 'PROCESS' | 'CONTROL' | 'EFFECT' | 'WAIT' | 'TERMINAL';
    subtype: string;
  };
  input: Record<string, unknown>;
  data: {
    payloads: Record<string, unknown>;
    facts: Record<string, unknown>;
    decisions: Record<string, unknown>;
    checks: Record<string, unknown>;
    results: Record<string, unknown>;
  };
  steps: Record<string, StepRuntimeState>;
  timeline: TimelineEntry[];
  result: TerminalResult | null;
  meta: JsonObject;
}
```

State v2 does not persist legacy runtime zones `context`, `history`, `context.effects`, or runtime `waitResult` projections. Domain payload fields named `waitResult` inside `input` or `data` are not forbidden by name. EFFECT executions are stored under `steps.<effectStepId>.executions[]`. The virtual path segment `latest` resolves through `latestExecutionId`, for example `$.steps.send_create_client.latest.command.result`.

`traceMode: 'off'` still keeps minimal `steps` and `timeline`; it only controls how much detail helpers expose. `PROCESS/DATA` write values remain persisted in `dataflow.writes[]` for auditability even in `off` and `basic` modes; `verbose` adds extra input/trace detail where supported.

## Step Definitions

### PROCESS/DATA

```ts
{
  id: string;
  type: 'PROCESS';
  subtype: 'DATA';
  title: string;
  description: string;
  artefactId: string;
  nextStepId: string;
  metadata?: JsonObject;
}
```

Forbidden fields: `contract`, `inputRef`, `outputRef`, `cases`, `onErrorStepId`, `onTimeoutStepId`.

`PROCESS/DATA` does not own data contracts. The referenced dataflow artifact owns input/output.

### CONTROL/ROUTE

```ts
{
  id: string;
  type: 'CONTROL';
  subtype: 'ROUTE';
  title: string;
  description: string;
  ref: string; // must start with $.data.
  cases: Record<string, string>;
  defaultNextStepId: string;
  metadata?: JsonObject;
}
```

Runtime behavior:

- Missing `ref` path -> `FLOW_ROUTE_REF_NOT_RESOLVED`.
- Object or array value -> `FLOW_ROUTE_REF_NOT_SCALAR`.
- No matching case -> `defaultNextStepId`.

### EFFECT

```ts
{
  id: string;
  type: 'EFFECT';
  subtype: 'COMMAND' | 'CALL' | 'SUBFLOW';
  title: string;
  description: string;
  operationId: string;
  inputRef: string; // $.input* or $.data*
  nextStepId: string;
  onErrorStepId: string;
  onTimeoutStepId?: string;
  flowId?: string;      // SUBFLOW only, required for SUBFLOW
  flowVersion?: string; // SUBFLOW only, required for SUBFLOW
  metadata?: JsonObject;
}
```

`COMMAND` and `SUBFLOW` may transition to `WAIT/MESSAGE` for asynchronous completion. `CALL` is synchronous: it must complete in `apply(...)` and must not transition to `WAIT/MESSAGE`.

### WAIT/MESSAGE

```ts
{
  id: string;
  type: 'WAIT';
  subtype: 'MESSAGE';
  title: string;
  description: string;
  sourceStepId: string; // must reference an EFFECT step
  nextStepId: string;
  onErrorStepId: string;
  onTimeoutStepId: string;
  metadata?: JsonObject;
}
```

`resume(...)` receives a transient `ResumeEvent`; the event is not persisted as `waitResult`.

### TERMINAL

```ts
{
  id: string;
  type: 'TERMINAL';
  subtype: 'COMPLETE' | 'FAIL';
  title: string;
  description: string;
  result?: { status: 'COMPLETE' | 'FAIL'; outcome: string; [k: string]: JsonValue };
  resultRef?: string; // must start with $.data.results.
  metadata?: JsonObject;
}
```

Exactly one of `result` or `resultRef` is required. `result.status` must match `subtype`.

## Public API

```ts
validateFlow(source, options?) -> ValidationResult
prepareFlow(source, options?) -> PreparedFlow
createProcessState(params) -> ProcessState
plan(flow, state) -> NormalizedStep
reduce(step, state, output) -> ProcessState
apply(flow, state, stepId, effectResult) -> ProcessState
resume(flow, state, stepId, resumeEvent) -> ProcessState
```

## Runtime Semantics

`plan(...)` returns the normalized current step and does not mutate state.

`reduce(PROCESS/DATA, state, DataflowOutput)`:

- Applies `DataflowOutput.writes[]` atomically.
- Every `write.ref` must start with `$.data.`.
- Every `write.value` must be JSON-safe.
- Advances to `nextStepId`.

`reduce(CONTROL/ROUTE, state, null)` advances to the selected transition.

`apply(EFFECT, ...)` records a command/subflow execution under `steps.<effectStepId>.executions[]`. If a `COMMAND` or `SUBFLOW` next step is WAIT, the execution status remains `WAITING` until `resume(...)`.

`resume(WAIT, ...)` attaches the transient resume event result to the latest source EFFECT execution, records the WAIT execution, and advances by success/error/timeout outcome.

`reduce(TERMINAL, ...)` finalizes the process from either a static `result` or a `resultRef` under `$.data.results.*`.

## Canonical Post-WAIT Bridge

Only the first `PROCESS/DATA` step immediately after a `WAIT/MESSAGE` step may read the source EFFECT result through:

```text
$.steps.<sourceEffectStepId>.latest.command.*
$.steps.<sourceEffectStepId>.latest.subflow.*
```

That bridge step must normalize external response data into `$.data.*`. Downstream DATA, ROUTE, EFFECT, and TERMINAL steps must read normalized `$.data.*` or process input.

## Key Diagnostics

| Code | Trigger |
|------|---------|
| `FLOW_INVALID_SUBTYPE` | Removed Flow 3 step subtype |
| `FLOW_DATA_STEP_FORBIDDEN_FIELD` | Flow-level DATA owns forbidden data contract fields |
| `FLOW_ROUTE_FACTREF_REMOVED` | `factRef` on ROUTE |
| `FLOW_ROUTE_REF_INVALID` | ROUTE ref outside `$.data.*` |
| `FLOW_EFFECT_INPUT_INVALID` | EFFECT inputRef outside `$.input*` / `$.data*` |
| `FLOW_EFFECT_ON_ERROR_MISSING` | EFFECT without `onErrorStepId` |
| `FLOW_WAIT_SOURCE_NOT_EFFECT` | WAIT source does not reference EFFECT |
| `FLOW_TERMINAL_RESULTREF_INVALID` | resultRef outside `$.data.results.*` |
| `FLOW_DATA_WRITE_FORBIDDEN_PATH` | DATA write outside `$.data.*` |
| `FLOW_CONTEXT_FORBIDDEN` | State v1 `context` object passed to State v2 runtime |
| `FLOW_CONTEXT_EFFECTS_FORBIDDEN` | Persisted `context.effects` detected |
| `FLOW_WAIT_RESULT_PERSISTED_FORBIDDEN` | Persisted runtime `waitResult` projection detected |
