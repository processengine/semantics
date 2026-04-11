# Compatibility Policy

## Current public contract

The current contract is the canonical `flows` model documented in:
- [README.md](./README.md)
- [SPEC.md](./SPEC.md)
- [SPEC_RU.md](./SPEC_RU.md)

Stable public areas:
- Flow DSL fields and meanings
- `ProcessState` root fields and status values
- Normalized step shapes
- `effectResult` / `waitResult` contracts
- Validation result shape
- Typed error families and stable error codes

## Intentionally non-frozen areas

- Internal `PreparedFlow` structure
- Internal indexes and caches
- Internal implementation details used to support runtime transitions

## Breaking changes in the canonical model

The current contract is not backward-compatible with the older `2.0.x` pre-canon model.

Notable breaking changes:
- `steps` is an object map, not an array
- every step requires `subtype`
- `WAIT` is `WAIT/MESSAGE`
- active status is `ACTIVE`, not `RUNNING`
- EFFECT uses `operationId`, not `artefactId`
- runtime correlation contract uses `requestId` only

## Legacy policy

Legacy snapshot/runtime APIs, subtype-less `PROCESS`, array-form `steps`, `RUNNING`, `correlationKey`, and EFFECT `artefactId` are not part of the supported public contract.
