# `@processengine/semantics`

**Canonical implementation of subject-level process semantics for the ProcessEngine family.**

`semantics` interprets [Flow3](#flow3-dsl) — the declarative process description language — and provides a transport-safe, orchestrator-agnostic runtime for process state transitions.

---

## Role in ProcessEngine

```
Flow3 DSL artifact
       │
       ▼
 ┌─────────────┐
 │  semantics  │  ← this library
 └─────────────┘
       │   plan / reduce / apply / resume
       ▼
 ┌──────────────┐
 │ orchestrator │  lifecycle: execute modules, persist state,
 └──────────────┘  dispatch effects, schedule, correlate
       │
       ▼
   runtime        infrastructure: Kafka, HTTP, DB, timers
```

**`semantics` owns:** Flow3 interpretation, compile/prepare validation, canonical process state, `plan(...)`, `reduce(...)`, `apply(...)`, `resume(...)`, internal resolution of `CONTROL` steps.

**`semantics` does not own:** runtime module execution, persistence, transport, retry, scheduling, external side-effect dispatch, `requestId` generation.

> API method names (`validateFlow`, `prepareFlow`, etc.) are preserved for compatibility. The architectural role these methods implement is the `semantics` layer.

---

## Install

```sh
npm install @processengine/semantics
```

---

## Quick start

```ts
import {
  validateFlow,
  prepareFlow,
  createProcessState,
  plan,
  reduce,
  apply,
  resume,
} from '@processengine/semantics';

// 1. Validate and prepare the Flow3 artifact
const validation = validateFlow(flow);
if (!validation.isValid) throw new Error(formatValidationIssues(validation.errors));
const preparedFlow = prepareFlow(flow);

// 2. Create a process instance
let state = createProcessState({ flow: preparedFlow, processId: 'order-001', input: { ... } });

// 3. Run the execution loop (orchestrator responsibility)
while (state.status === 'ACTIVE') {
  const step = plan(preparedFlow, state);

  if (step.type === 'PROCESS') {
    // orchestrator executes the module and gets output
    const output = await executeModule(step.artefactId, step.input);
    state = reduce(step, state, output);
  }

  if (step.type === 'CONTROL') {
    // semantics already resolved the transition — just commit
    state = reduce(step, state, null);
  }

  if (step.type === 'EFFECT') {
    // orchestrator dispatches external effect and registers result
    const requestId = generateRequestId();
    await dispatchEffect(step.operationId, step.input, requestId);
    state = apply(preparedFlow, state, step.id, { requestId, result: { status: 'ACCEPTED' }, error: null, errorCode: null });
    // process is now WAITING — schedule for later
    break;
  }

  if (step.type === 'WAIT') {
    // external result arrived — resume
    state = resume(preparedFlow, state, step.id, { requestId, result: externalResult, error: null, errorCode: null });
  }

  if (step.type === 'TERMINAL') break;
}
```

---

## Flow3 DSL

Flow3 is the canonical process description language interpreted by `semantics`.

A Flow3 artifact is a JSON object with `id`, `version`, `entryStepId`, and `steps`. The `steps` is an object map (`Record<StepId, StepDefinition>`) from step id to step definition.

### Step types

| `type`       | `subtype`                    | Owner              | Description |
|-------------|-----------------------------|--------------------|-------------|
| `PROCESS`   | `RULES` `MAPPINGS` `DECISIONS` | orchestrator       | Executable steps — call a registered module |
| `CONTROL`   | `ROUTE` `SWITCH`             | semantics (internal) | Routing — resolved by `plan()`, never reach `executeStep` |
| `EFFECT`    | `COMMAND` `CALL` `SUBFLOW`   | orchestrator       | External side effects |
| `WAIT`      | `MESSAGE` (`WAIT/MESSAGE`)   | orchestrator       | Suspend until external result arrives |
| `TERMINAL`  | `COMPLETE` `FAIL`            | semantics          | End the process. Supports static `result` or dynamic `resultRef`. |

### Minimal Flow3 example

```json
{
  "id": "order.validation",
  "version": "2026-04-01",
  "entryStepId": "validate_input",
  "steps": {
    "validate_input": {
      "id": "validate_input",
      "type": "PROCESS",
      "subtype": "RULES",
      "artefactId": "rules.order.validate",
      "contract": {
        "input":  { "ref": "$.context.input" },
        "output": { "ref": "$.context.checks.validation" }
      },
      "nextStepId": "route_validation"
    },
    "route_validation": {
      "id": "route_validation",
      "type": "CONTROL",
      "subtype": "ROUTE",
      "factRef": "$.context.checks.validation.passed",
      "cases": { "true": "finish_ok", "false": "finish_fail" },
      "defaultNextStepId": "finish_fail"
    },
    "finish_ok": {
      "id": "finish_ok",
      "type": "TERMINAL",
      "subtype": "COMPLETE",
      "result": { "status": "COMPLETE", "outcome": "ORDER_VALID" }
    },
    "finish_fail": {
      "id": "finish_fail",
      "type": "TERMINAL",
      "subtype": "FAIL",
      "result": { "status": "FAIL", "outcome": "ORDER_INVALID" }

// Or use resultRef for dynamic result (e.g. with per-field validation errors):
//   "type": "TERMINAL",
//   "subtype": "FAIL",
//   "resultRef": "$.context.facts.validationRejectResult"
// semantics resolves the path value and sets it as state.result
    }
  }
}
```

### Executable PROCESS step — `contract` binding

Executable `PROCESS` steps (RULES, MAPPINGS, DECISIONS) declare input/output bindings via `contract`:

```json
{
  "type": "PROCESS",
  "subtype": "MAPPINGS",
  "artefactId": "mappings.enrich",
  "contract": {
    "input":  { "ref": "$.context.checks.validation" },
    "output": { "ref": "$.context.facts.enriched" }
  },
  "nextStepId": "next_step"
}
```

- `contract.input.ref` — path resolved by `semantics` from current state; becomes `step.input` in the normalized step
- `contract.output.ref` — path where `reduce(...)` writes module output

### CONTROL steps

`CONTROL/ROUTE` and `CONTROL/SWITCH` are resolved entirely inside `semantics`. The orchestrator never calls `executeStep` for them — it calls `reduce(step, state, null)` to commit the already-resolved transition.

```json
{
  "type": "CONTROL",
  "subtype": "SWITCH",
  "decisionSetId": "route_decision",
  "cases": {
    "APPROVE": "step_approve",
    "REJECT":  "step_reject"
  },
  "defaultNextStepId": "step_manual"
}
```

### EFFECT steps

```json
{
  "type": "EFFECT",
  "subtype": "COMMAND",
  "operationId": "abs.create_beneficiary",
  "inputRef": "$.context.facts.abs_request",
  "nextStepId": "wait_abs_response",
  "onErrorStepId": "finish_fail"
}
```

`inputRef` on `EFFECT` steps is the canonical binding field (not `contract`).

---

## Public API

```ts
validateFlow(flow, options?)  -> ValidationResult
prepareFlow(flow, options?)   -> PreparedFlow

createProcessState(params)                         -> ProcessState
plan(preparedFlow, state)                          -> NormalizedStep
reduce(step, state, output)                        -> ProcessState
apply(preparedFlow, state, stepId, effectResult)   -> ProcessState
resume(preparedFlow, state, stepId, waitResult)    -> ProcessState

formatValidationIssues(issues) -> string
formatRuntimeError(error)      -> string
```

### `plan(preparedFlow, state) -> NormalizedStep`

Deterministically materializes the current step from `preparedFlow` and `state`. Does not mutate state.

Performs three operations:
1. **Normalization** — projects step definition into a transport-safe packet
2. **Binding resolution** — resolves `contract.input.ref` (PROCESS) or `inputRef` (EFFECT); materializes `requestId` and `operationId` for WAIT steps
3. **Control resolution** — for `CONTROL` steps evaluates branching and carries `selectedNextStepId` in the result

### `reduce(step, state, output) -> ProcessState`

Commits a step transition:
- **PROCESS**: writes `output` to `contract.output.ref` and advances to `nextStepId`
- **CONTROL**: commits the already-resolved `selectedNextStepId`; `output` must be `null`

### Step types from `plan(...)`

```
step.type === 'PROCESS'  → step.artefactId, step.subtype, step.input
step.type === 'CONTROL'  → step.subtype, step.selectedNextStepId
step.type === 'EFFECT'   → step.operationId, step.subtype, step.input
step.type === 'WAIT'     → step.sourceStepId, step.operationId, step.requestId
step.type === 'TERMINAL' → step.subtype, step.result (static) or step.resultRef (dynamic)
```

---

## Error handling

```ts
import { XCompileError, XRuntimeError, formatValidationIssues, formatRuntimeError } from '@processengine/semantics';

try {
  const state2 = reduce(step, state, output);
} catch (err) {
  if (err instanceof XRuntimeError) {
    console.error(err.code, err.message); // FLOW_REDUCE_INVALID_TYPE, etc.
  }
}
```

All runtime errors carry a stable machine-readable `code` (e.g. `FLOW_STEP_MISMATCH`, `FLOW_PATH_NOT_RESOLVED`).

---

## ProcessState shape

```ts
interface ProcessState {
  id: string;          // flow id
  version: string;     // flow version
  processId: string;
  status: 'ACTIVE' | 'WAITING' | 'COMPLETE' | 'FAIL';  // ACTIVE | WAITING | COMPLETE | FAIL
  traceMode: 'off' | 'basic' | 'verbose';
  currentStepId: string;
  currentStepType: 'PROCESS' | 'CONTROL' | 'EFFECT' | 'WAIT' | 'TERMINAL';
  currentStepSubtype: string;
  context: ProcessContext;
  history: ProcessHistoryEntry[];
  result: TerminalResult | null;
  meta: JsonObject;
}
```

`ProcessState` is a plain JSON-safe object. The orchestrator owns persistence and transport of state.

---

## JSON Schema

A JSON Schema for Flow3 artifacts is bundled at `dist/schema/flow3-1.0.0.schema.json`.

