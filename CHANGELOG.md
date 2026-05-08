# Changelog

All notable changes to `@processengine/semantics` are documented here.

## [Unreleased]

## [1.1.0] — 2026-05-08

### Added

- **`TERMINAL.resultRef`** — dynamic terminal result resolution by semantics.  
  A TERMINAL step can now specify `resultRef` (a state path, e.g. `$.context.facts.myResult`)
  instead of a static inline `result`. When the process transitions into that terminal step,
  semantics reads the value at the given path, validates its shape, and sets it as `state.result`.
  This is the canonical solution for dynamic terminal payloads (e.g. validation reject with
  per-field errors) — semantics owns the final result, no post-processing in the host runtime
  is required.

- **New runtime error codes**: `FLOW_RESULT_REF_NOT_RESOLVED`, `FLOW_RESULT_REF_SHAPE_INVALID`.

- **Compile-time validation** for `resultRef`:
  - exactly one of `result` or `resultRef` must be present;
  - `resultRef` must be a valid path (validated via `isValidPath`);
  - `entryStepId` cannot point to a TERMINAL step with `resultRef` (compile-time error).

- **Runtime validation** for resolved `resultRef` value:
  - must be a JSON-safe object;
  - must have a non-empty string `outcome`;
  - `status` must match the TERMINAL `subtype` (`COMPLETE` or `FAIL`).

- **JSON Schema** (`dist/schema/flow.schema.json`) updated: TERMINAL step now allows `oneOf`
  with either `result` or `resultRef`, with mutual exclusion enforced.

- **13 new tests** covering: static result (backward compat), `resultRef` runtime resolution,
  path-missing error, status mismatch error, missing outcome error, compile-time validation
  (both/neither/invalid path/entry resultRef), `validateFlow` coverage.

### Changed

- `NormalizedTerminalStep.result` is now optional (present only when using static `result`).
  `NormalizedTerminalStep.resultRef` is present when using dynamic `resultRef`.
  This is a **minor breaking change** for consumers inspecting `NormalizedTerminalStep` — see COMPATIBILITY.

## [1.0.0] — 2026-04-15

- Initial canonical release aligned to Flow3 specification.
- Introduced `plan`, `reduce`, `apply`, `resume`, `createProcessState`, `validateFlow`, `prepareFlow`.
- Canonical `PROCESS / CONTROL / EFFECT / WAIT / TERMINAL` step taxonomy.
- Transport-safe `ProcessState` shape.
- `CONTROL` steps resolved entirely inside semantics.
- `TERMINAL` with static inline `result`.
