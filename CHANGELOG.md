# Changelog

All notable changes to `@processengine/semantics` are documented here.

## [Unreleased]

- Treat `ResumeEvent.errorCode: "TIMEOUT"` as a failure even when no error payload is provided.
- Preserve step `title` and `description` in `state.steps` for executed PROCESS, CONTROL, EFFECT, WAIT, and TERMINAL steps.
- Add source EFFECT completion/failure events to `timeline` when a WAIT is resumed.
- Narrow persisted `waitResult` rejection to legacy runtime projections instead of domain payload fields named `waitResult`.

## [3.0.0] — 2026-05-25

### Added

- Flow 5 State v2 runtime contract with `stateVersion: "flow5-state-v2"`.
- Root `current`, `input`, `data`, `steps`, `timeline`, `result`, and `meta` state sections.
- Step execution records under `steps.<stepId>.executions[]`.
- Virtual `$.steps.<stepId>.latest.*` path resolution through `latestExecutionId`.
- Transient `ResumeEvent` support for `resume(...)`.
- State v2 validation diagnostics for forbidden `context`, `context.effects`, persisted `waitResult`, invalid step executions, and invalid timeline.

### Changed

- `PROCESS/DATA` writes now target `$.data.*` instead of `$.context.data.*`.
- `CONTROL/ROUTE.ref` must read from `$.data.*`.
- `EFFECT.inputRef` must read from `$.input*` or `$.data*`.
- `TERMINAL.resultRef` must read from `$.data.results.*`.
- Trace helpers now read `timeline` and `steps`; `traceMode: "off"` keeps minimal runtime observability.
- JSON Schema, examples, SPEC, README, and migration guide now describe State v2.

### Removed

- State v1 `context` and `history` runtime shape.
- Persisted `context.effects`.
- Persisted `waitResult`.
- `currentStepId`, `currentStepType`, and `currentStepSubtype` root fields.

### Breaking

- v3.0.0 is not backward-compatible with `@processengine/semantics` v2.x persisted states or refs.
- Consumers must migrate refs from `$.context.data.*` to `$.data.*` and process input from `$.context.input.*` to `$.input.*`.

## [2.0.0] — 2026-05-17

### Added

- Flow 5 source artifact contract with required `title` and `description` on flow and steps.
- Flow 5 process state shape with explicit `flowId`, `flowVersion`, and `context.data.*` namespaces.
- `PROCESS/DATA` as the only flow-level PROCESS subtype.
- `CONTROL/ROUTE` with `ref` as the only routing primitive.
- `TERMINAL.resultRef` restricted to `$.context.data.results.*`.
- `reduce(TERMINAL, state, null)` as canonical terminal finalization.
- Public JSON Schema export for Flow 5 via `@processengine/semantics/schema`.
- Pack smoke validation that all packaged examples pass both `validateFlow(...)` and the exported JSON Schema.

### Changed

- Flow graph now describes lifecycle only; synchronous rules/mappings/decisions logic must live inside `@processengine/dataflows` artifacts referenced by `PROCESS/DATA`.
- `PROCESS/DATA` reduce consumes `DataflowOutput.writes[]` and writes only under `$.context.data.*`.
- `EFFECT.onErrorStepId` is required for `COMMAND`, `CALL`, and `SUBFLOW`.
- `WAIT.sourceStepId` must reference an EFFECT step.
- Runtime public boundary now defensively rejects malformed flow/state/result inputs with typed `XRuntimeError` codes.

### Removed

- Flow 3 flow-level PROCESS subtypes: `PROCESS/RULES`, `PROCESS/MAPPINGS`, `PROCESS/DECISIONS`.
- `CONTROL/SWITCH`.
- `CONTROL/ROUTE.factRef`; use `CONTROL/ROUTE.ref`.
- Canonical root sections `context.checks`, `context.facts`, and `context.decisions`; use `context.data.checks`, `context.data.facts`, and `context.data.decisions`.
- Object input refs / hidden input assembly.
- Flow 3 examples and docs from the public npm package.

### Breaking

- v2.0.0 is not backward-compatible with Flow 3 artifacts or Flow 3 process state.
- There is no compatibility mode or legacy alias layer. Use v1.x for Flow 3 runtime, or migrate artifacts to Flow 5.
