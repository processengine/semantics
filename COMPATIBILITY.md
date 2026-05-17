# Compatibility Policy — `@processengine/semantics` v2

## Current line

`@processengine/semantics` v2.0.0 is the Flow 5 canonical contract.

It is not compatible with Flow 3 source artifacts or Flow 3 process state shape.
There is no compatibility mode, alias layer, or hidden Flow 3 fallback.

## Stable public areas

The following are public compatibility surfaces for v2.x unless a future major version changes them:

- Flow 5 source artifact shape documented in `SPEC.md` / `SPEC_RU.md`.
- Flow 5 step taxonomy:
  - `PROCESS/DATA`
  - `CONTROL/ROUTE`
  - `EFFECT/COMMAND`, `EFFECT/CALL`, `EFFECT/SUBFLOW`
  - `WAIT/MESSAGE`
  - `TERMINAL/COMPLETE`, `TERMINAL/FAIL`
- Public lifecycle API:
  - `validateFlow(source)`
  - `prepareFlow(source)`
  - `createProcessState(params)`
  - `plan(preparedFlow, state)`
  - `reduce(step, state, output?)`
  - `apply(preparedFlow, state, stepId, effectResult)`
  - `resume(preparedFlow, state, stepId, waitResult)`
- Flow 5 `ProcessState` root fields and `context.data.*` namespaces.
- Normalized step public shapes.
- Dataflow write application contract for `PROCESS/DATA`.
- `CONTROL/ROUTE.ref` scalar routing contract.
- `TERMINAL.result` / `TERMINAL.resultRef` runtime contract.
- Typed compile/runtime errors and stable machine-readable error codes.
- Public JSON Schema export at `@processengine/semantics/schema`.

## Intentionally internal / non-frozen areas

The following must not be depended on by consumers:

- Internal indexes and caches inside `PreparedFlow` beyond documented public fields.
- Internal ordering algorithms, as long as observable semantics remain unchanged.
- Internal trace implementation details not described in the SPEC.
- File layout inside `src/` or `dist/` except public `exports`.

Prepared artifacts are runtime-ready and immutable by public contract, but they are not guaranteed to be a stable persistence format. Persist source flow artifacts and prepare them for runtime.

## Flow 3 incompatibilities

Flow 5 removes these Flow 3 public shapes:

```text
PROCESS/RULES
PROCESS/MAPPINGS
PROCESS/DECISIONS
CONTROL/SWITCH
CONTROL/ROUTE.factRef
context.checks
context.facts
context.decisions
state.id / state.version as flow identity
object inputRef assembly
```

Use the migration guide in `docs/MIGRATION_GUIDE.md` to rewrite Flow 3 artifacts to Flow 5.

## Node and module compatibility

- Supported Node.js: `>=20.19.0`.
- Package type: native ESM (`"type": "module"`).
- CJS `require()` is not a supported contract for v2.

## JSON Schema compatibility

The exported schema is part of the public contract. Every official example shipped in the npm package must validate against:

```text
@processengine/semantics/schema
```

The test and pack-smoke suites enforce this so schema, examples, docs, and runtime do not drift apart.
