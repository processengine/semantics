# Scheduler Guide

`flows` does not own scheduling or timers.

## Host loop

Canonical Host loop:

1. load `PreparedFlow`
2. load `ProcessState`
3. call `plan(preparedFlow, state)`
4. dispatch by normalized step:
   - executable `PROCESS` -> execute runtime module -> `reduce(...)`
   - `EFFECT` -> execute Host side effect -> `apply(...)`
   - `WAIT` -> park process until external result arrives -> `resume(...)`
   - `TERMINAL` -> no further runtime call

## Timeouts

Timeout policy is Host-owned. When Host decides that an awaited external result timed out:

```ts
resume(preparedFlow, state, waitStepId, {
  requestId,
  result: null,
  error: { code: 'TIMEOUT' },
  errorCode: 'TIMEOUT',
});
```

`flows` then routes to `WAIT.onTimeoutStepId`.

## Important boundary

The scheduler must not encode DSL semantics. It should only decide when to wake a process and which canonical runtime method to call.
