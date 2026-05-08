# `@processengine/semantics` — Specification

**Version:** 1.1.0  
**DSL:** Flow3  
**Role:** semantics layer of the ProcessEngine family

---

## 1. Purpose

`semantics` is the process-meaning engine of the ProcessEngine family. It interprets **Flow3** — the canonical declarative process description language — and provides transport-safe, deterministic process state transitions.

`semantics` owns: DSL validation and preparation, `plan(...)`, `reduce(...)`, `apply(...)`, `resume(...)`, canonical process state, internal CONTROL resolution.

`semantics` does not own: runtime module execution, persistence, transport, retry, scheduling, external effect dispatch, `requestId` generation.

---

## 2. Architecture

```
Flow3 artifact
     │
     ▼
 semantics          (this library)
     │
     ▼
 orchestrator       executes modules, persists state, dispatches effects
     │
     ▼
 runtime            infrastructure: Kafka, HTTP, DB, timers
```

The orchestrator **must not** interpret Flow3 semantics (routing conditions, step graph, path resolution). `semantics` **must not** execute infrastructure responsibilities. This separation is normative.

---

## 3. Flow3 DSL

### 3.1. Step taxonomy

The `steps` field in a Flow3 artifact must be a non-empty object map (`Record<StepId, StepDefinition>`).

| `type`     | `subtype`                    | Resolved by    |
|------------|------------------------------|----------------|
| `PROCESS`  | `RULES` `MAPPINGS` `DECISIONS` | orchestrator via `executeStep` |
| `CONTROL`  | `ROUTE` `SWITCH`             | semantics internally — never reach `executeStep` |
| `EFFECT`   | `COMMAND` `CALL` `SUBFLOW`   | orchestrator   |
| `WAIT`     | `MESSAGE` (`WAIT/MESSAGE`)   | orchestrator   |
| `TERMINAL` | `COMPLETE` `FAIL`            | semantics — resolves `result` or `resultRef` |

### 3.2. Executable PROCESS — `contract` binding

Executable `PROCESS` steps use `contract.input.ref` and `contract.output.ref`:

```json
{
  "type": "PROCESS",
  "subtype": "RULES",
  "artefactId": "rules.validate",
  "contract": {
    "input":  { "ref": "$.context.input" },
    "output": { "ref": "$.context.checks.validation" }
  },
  "nextStepId": "next"
}
```

`contract.input.ref` — resolved by `plan(...)` into `step.input`.  
`contract.output.ref` — used by `reduce(...)` to write module output into state.  
`inputRef` / `outputRef` are **forbidden** on executable PROCESS steps.

### 3.3. CONTROL steps

`CONTROL/ROUTE` reads `factRef` (a scalar path) and selects a branch from `cases`.  
`CONTROL/SWITCH` reads `context.decisions[decisionSetId].outcome` and selects from `cases`.  
Both must have `defaultNextStepId`. Both are resolved entirely inside `semantics`.

```json
{ "type": "CONTROL", "subtype": "ROUTE", "factRef": "$.context.facts.ok",
  "cases": { "true": "step_ok", "false": "step_fail" }, "defaultNextStepId": "step_fail" }
```

### 3.4. EFFECT steps

```json
{ "type": "EFFECT", "subtype": "COMMAND", "operationId": "abs.create",
  "inputRef": "$.context.facts.request", "nextStepId": "wait_abs", "onErrorStepId": "finish_fail" }
```

`inputRef` is the canonical input binding for `EFFECT` steps. `operationId` is the orchestrator dispatch key.

For `SUBFLOW`, `flowId` and `flowVersion` are required:

```json
{ "type": "EFFECT", "subtype": "SUBFLOW", "operationId": "child.process",
  "flowId": "child.flow", "flowVersion": "2026-04-01",
  "inputRef": "$.context.facts.input", "nextStepId": "wait_child" }
```

### 3.5. WAIT step

```json
{ "type": "WAIT", "subtype": "MESSAGE", "sourceStepId": "send_command",
  "nextStepId": "next", "onErrorStepId": "finish_fail", "onTimeoutStepId": "finish_timeout" }
```

`plan(...)` materializes `operationId` (from source EFFECT step) and `requestId` (from `context.effects`) into the normalized WAIT step.

### 3.6. Context namespaces

| Zone                | Written by            |
|--------------------|-----------------------|
| `context.input`    | `createProcessState`  |
| `context.checks`   | executable PROCESS    |
| `context.facts`    | executable PROCESS    |
| `context.decisions`| DECISIONS steps       |
| `context.effects`  | `apply(...)` / `resume(...)` |
| `context.steps`    | trace (when `traceMode !== 'off'`) |

### 3.5. TERMINAL step

`TERMINAL` ends the process. Semantics sets `state.status` and `state.result` and no further runtime calls are allowed.

A TERMINAL step must have exactly one of:

**Static `result`** — inline JSON-safe object:
```json
{
  "type": "TERMINAL", "subtype": "FAIL",
  "result": { "status": "FAIL", "outcome": "VALIDATION_REJECT", "reasonCode": "..." }
}
```

**Dynamic `resultRef`** — path to a value pre-computed in process state:
```json
{
  "type": "TERMINAL", "subtype": "FAIL",
  "resultRef": "$.context.facts.validationRejectResult"
}
```

When `resultRef` is used, semantics reads the value at that path when the process transitions into the TERMINAL step. The resolved value must be:
- a JSON-safe object;
- have a non-empty string `outcome`;
- have `status` matching the step `subtype` (`COMPLETE` or `FAIL`).

`resultRef` cannot be used when the step is `entryStepId` (compile-time error).

`resultRef` is the canonical mechanism for dynamic terminal payloads — the host runtime must not post-process `state.result` after semantics has set it.


---

## 4. Public API

```
validateFlow(flow, options?)  -> ValidationResult
prepareFlow(flow, options?)   -> PreparedFlow

createProcessState(params)                         -> ProcessState
plan(preparedFlow, state)                          -> NormalizedStep
reduce(step, state, output)                        -> ProcessState
apply(preparedFlow, state, stepId, effectResult)   -> ProcessState
resume(preparedFlow, state, stepId, waitResult)    -> ProcessState
```

### 4.1. `validateFlow(flow, options?)`

Returns `{ isValid: boolean; errors: ValidationIssue[]; warnings: ValidationIssue[] }`.  
Must not throw for ordinary DSL problems.

### 4.2. `prepareFlow(flow, options?)`

Returns an immutable `PreparedFlow`. Throws `XCompileError` if the artifact is invalid.

### 4.3. `createProcessState(params)`

```
createProcessState({ flow: PreparedFlow, processId: string, input?, meta?, trace? }) -> ProcessState
```

Creates the canonical initial `ProcessState`. Binds state to `preparedFlow.id` and `preparedFlow.version`. Sets `currentStepId` to `preparedFlow.entryStepId`. Sets `status` to `ACTIVE`. The only canonical way to produce a valid initial state.

### 4.4. `plan(preparedFlow, state)`

Deterministically materializes the current normalized step without mutating state. Performs:
1. **Normalization** — transport-safe step packet
2. **Binding resolution** — resolves `contract.input.ref` for PROCESS; `inputRef` for EFFECT; materializes `requestId` and `operationId` for WAIT
3. **Control resolution** — for CONTROL steps evaluates branching condition and carries `selectedNextStepId`

### 4.5. `reduce(step, state, output)`

Commits a state transition. Applies to `PROCESS` and `CONTROL` steps:
- `PROCESS`: writes `output` to `contract.output.ref`; advances to `nextStepId`
- `CONTROL`: commits `selectedNextStepId`; `output` must be `null`

### 4.6. `apply(preparedFlow, state, stepId, effectResult)`

Records the dispatch of an EFFECT step. Transitions process to `WAITING`. Sets `context.effects[stepId].requestId`.

`effectResult` shape: `{ requestId: string; result: unknown; error: unknown; errorCode: string | null }`.

### 4.7. `resume(preparedFlow, state, stepId, waitResult)`

Delivers an external result to a WAIT step. Transitions process from `WAITING` back to `ACTIVE` (or to a failure/timeout branch).

`waitResult` shape: `{ requestId: string; result: unknown; error: unknown; errorCode: string | null }`.

---

## 5. Normalized step contract

`plan(...)` returns a `NormalizedStep` — a transport-safe, self-sufficient packet. The orchestrator reads only normalized step fields; it must not inspect `PreparedFlow` internals or `ProcessState` directly.

| `step.type` | Key fields |
|------------|-----------|
| `PROCESS`  | `artefactId`, `subtype`, `input` |
| `CONTROL`  | `subtype`, `selectedNextStepId` |
| `EFFECT`   | `operationId`, `subtype`, `input` |
| `WAIT`     | `sourceStepId`, `operationId`, `requestId` |
| `TERMINAL` | `subtype`, `result` (static) or `resultRef` (dynamic) |

---

## 6. ProcessState

```ts
{
  id: string;          // flow id
  version: string;     // flow version (bound at createProcessState)
  processId: string;
  status: 'ACTIVE' | 'WAITING' | 'COMPLETE' | 'FAIL';
  traceMode: 'off' | 'basic' | 'verbose';
  currentStepId: string;
  currentStepType: string;
  currentStepSubtype: string;
  context: ProcessContext;
  history: ProcessHistoryEntry[];
  result: TerminalResult | null;
  meta: JsonObject;
}
```

`ProcessState` is a plain JSON-safe object. The orchestrator owns persistence and transport.

---

## 7. Error contract

Two error families:

**`XCompileError`** — thrown by `prepareFlow(...)` for structurally invalid Flow3 artifacts. Has `code` (`FLOW_*`), `message`, and optional `details`.

**`XRuntimeError`** — thrown by `plan(...)`, `reduce(...)`, `apply(...)`, `resume(...)` for runtime contract violations. Has `code` (`FLOW_*`), `message`, and optional `details`.

All `code` values are stable identifiers (e.g. `FLOW_STEP_MISMATCH`, `FLOW_PATH_NOT_RESOLVED`, `FLOW_REDUCE_INVALID_TYPE`). The orchestrator may use `code` for machine-readable error handling.

---

## 8. Invariants

- `plan(...)` is deterministic: same `preparedFlow` + `state` always produce the same `NormalizedStep`
- `plan(...)` never mutates state
- All public runtime contracts are transport-safe (JSON-safe)
- `ProcessState.version` must match `PreparedFlow.version` — enforced at every `plan(...)` call
- The orchestrator must not call `reduce(...)` for `EFFECT`, `WAIT`, or `TERMINAL` steps
- The orchestrator must not construct `ProcessState` manually — use `createProcessState(...)`
