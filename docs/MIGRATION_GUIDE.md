# Migration Guide

## From pre-canon `2.0.x` to canon-aligned `2.1.0`

This release is a contract realignment, not a patch-level cosmetic update.

## Required DSL changes

- change `steps` from array to object map
- ensure every step has explicit `subtype`
- replace subtype-less `PROCESS` with one of:
  - `RULES`
  - `MAPPINGS`
  - `DECISIONS`
  - `ROUTE`
  - `SWITCH`
- change `WAIT` to `subtype: "MESSAGE"`
- change EFFECT `artefactId` to `operationId`

## Required runtime changes

- change active status from `RUNNING` to `ACTIVE`
- change state flow binding field from `flowId` to `id`
- remove `flowVersion` from public `ProcessState`
- remove `correlationKey` from `effectResult`
- treat missing path resolution as runtime error
- treat mixed non-null `result + error` as runtime error

## Public API changes

Stable root export:
- `validateFlow`
- `prepareFlow`
- `plan`
- `reduce`
- `apply`
- `resume`

Added to root public export:
- `createProcessState` — the only canonical way to create initial `ProcessState`

## Validation result changes

Old shape:

```ts
{ ok, diagnostics }
```

New shape:

```ts
{ isValid, errors, warnings }
```

## Error changes

Old families:
- `FlowCompileError`
- `FlowRuntimeError`

New families:
- `XCompileError`
- `XRuntimeError`

## Runtime shape changes

Old EFFECT:

```json
{
  "type": "EFFECT",
  "artefactId": "legacy.effect"
}
```

New EFFECT:

```json
{
  "type": "EFFECT",
  "subtype": "COMMAND",
  "operationId": "remote.submit"
}
```

Old WAIT:

```json
{
  "type": "WAIT"
}
```

New WAIT:

```json
{
  "type": "WAIT",
  "subtype": "MESSAGE"
}
```
