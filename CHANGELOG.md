# Changelog

All notable changes to `@processengine/semantics` are documented here.

## [Unreleased]

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
