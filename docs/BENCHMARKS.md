# Benchmarks

Benchmark runs should measure the current canonical API only:

- `validateFlow(...)`
- `prepareFlow(...)`
- `plan(...)`
- `reduce(...)`
- `apply(...)`
- `resume(...)`

Benchmarks must not use legacy snapshot/runtime APIs.

## Suggested scenarios

- validation of medium and large flow graphs
- repeated `plan(...)` on executable PROCESS
- ROUTE and SWITCH planning
- `apply(...)` into WAIT
- `resume(...)` out of WAIT

See [../benchmarks/run.mjs](../benchmarks/run.mjs) for the current benchmark harness.
