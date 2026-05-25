# Compatibility Policy — `@processengine/semantics` v3

`@processengine/semantics` v3.0.0 is the Flow 5 State v2 canonical contract.

It is not compatible with Flow 3 artifacts, Flow 3 process state, or the Flow 5 State v1 shape from v2.x. There is no compatibility mode, alias layer, or hidden fallback.

## Stable Public Areas

- Flow 5 source artifact shape documented in `SPEC.md` / `SPEC_RU.md`.
- Step taxonomy: `PROCESS/DATA`, `CONTROL/ROUTE`, `EFFECT/*`, `WAIT/MESSAGE`, `TERMINAL/*`.
- Public lifecycle API: `validateFlow`, `prepareFlow`, `createProcessState`, `plan`, `reduce`, `apply`, `resume`.
- State v2 root fields: `stateVersion`, `current`, `input`, `data`, `steps`, `timeline`, `result`, `meta`.
- Dataflow write contract for `PROCESS/DATA`: writes only to `$.data.*`.
- ROUTE contract: `ref` reads a scalar under `$.data.*`.
- EFFECT input contract: `inputRef` reads from `$.input*` or `$.data*`.
- TERMINAL result contract: `resultRef` reads from `$.data.results.*`.
- Typed compile/runtime errors with stable machine-readable codes.
- Public JSON Schema export at `@processengine/semantics/schema`.

## Intentionally Internal

- PreparedFlow internal indexes and caches.
- Internal ordering and traversal details, as long as observable semantics stay stable.
- File layout inside `src/` or `dist/` except public `exports`.

Prepared artifacts are runtime-ready but are not a stable persistence format. Persist source Flow artifacts and prepare them for runtime.

## Removed Shapes

```text
PROCESS/RULES
PROCESS/MAPPINGS
PROCESS/DECISIONS
CONTROL/SWITCH
CONTROL/ROUTE.factRef
state.context
state.history
context.effects
persisted waitResult
state.currentStepId/currentStepType/currentStepSubtype
state.id / state.version as flow identity
object inputRef assembly
```

## Node and Module Compatibility

- Supported Node.js: `>=20.19.0`.
- Package type: native ESM.
- CJS `require()` is not a supported contract.

## JSON Schema Compatibility

Every official example shipped in the npm package must validate against `@processengine/semantics/schema`. The test and pack-smoke suites enforce schema, examples, docs, and runtime consistency.
