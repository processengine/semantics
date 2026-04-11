# Persistence Guide

## What Host persists

Host persists:
- canonical `ProcessState`
- the flow artifact identity used to load the matching `PreparedFlow`

`ProcessState` is the runtime unit for persistence and recovery.

## What `flows` expects on restore

When Host restores a process:
1. load the correct flow definition
2. call `prepareFlow(...)`
3. load the persisted `ProcessState`
4. call `plan(...)`, `apply(...)`, or `resume(...)` with the matching `PreparedFlow`

Runtime methods validate:
- `state.id` matches `preparedFlow.id`
- `currentStepId`, `currentStepType`, `currentStepSubtype` are consistent with the prepared flow

## What Host must not do

Host must not:
- resolve `inputRef`
- evaluate ROUTE or SWITCH
- rewrite `context.steps`
- rewrite `context.effects`

Those semantics belong to `flows`.

## Recommended persistence moments

Persist state:
- after each successful `reduce(...)`
- after each successful `apply(...)`
- after each successful `resume(...)`

This keeps recovery aligned with explicit semantic transitions.
