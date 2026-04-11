# Changelog

## 2.1.0

- realigned the library to the final ProcessEngine canon
- changed Flow DSL root to object-map `steps`
- made `subtype` mandatory for every step
- introduced canonical executable `PROCESS` subtypes: `RULES`, `MAPPINGS`, `DECISIONS`
- changed `WAIT` to explicit `WAIT/MESSAGE`
- changed active process status from `RUNNING` to `ACTIVE`
- changed EFFECT dispatch field from `artefactId` to `operationId`
- removed `correlationKey` from the public runtime contract
- changed validation result shape to `{ isValid, errors, warnings }`
- renamed public errors to `XCompileError` and `XRuntimeError`
- changed runtime contract so missing path resolution and mixed `result + error` are runtime violations
- removed public `createProcessState(...)` from the package root export
- rewrote README, SPEC, examples, and docs to the canonical model

## 2.0.1

- tightened `flows 2.0.0` docs and release checks
- fixed README and public examples around `plan / reduce / apply / resume`
- added README smoke tests, package artifact checks, and release docs coverage

## 2.0.0

- introduced the initial `flows 2.x` public API
- removed the legacy snapshot/runtime API from the package root

## 1.0.0

- legacy pre-canon runtime model
