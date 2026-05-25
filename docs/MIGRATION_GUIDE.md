# Migration Guide — Flow 3 / State v1 to Flow 5 State v2

Flow 5 State v2 is a major contract change. There is no compatibility mode.

## Step Taxonomy

```text
PROCESS/RULES       -> PROCESS/DATA with RULES item inside dataflow artifact
PROCESS/MAPPINGS    -> PROCESS/DATA with MAPPINGS item inside dataflow artifact
PROCESS/DECISIONS   -> PROCESS/DATA with DECISIONS item inside dataflow artifact
CONTROL/SWITCH      -> CONTROL/ROUTE
CONTROL/ROUTE.factRef -> CONTROL/ROUTE.ref
```

## State Shape

```text
state.id / state.version       -> state.flowId / state.flowVersion
state.currentStepId            -> state.current.stepId
state.currentStepType          -> state.current.type
state.currentStepSubtype       -> state.current.subtype
state.context.input            -> state.input
state.context.data.*           -> state.data.*
state.history                  -> state.timeline
context.effects                -> state.steps.<effectStepId>.executions[]
persisted waitResult           -> transient ResumeEvent passed to resume(...)
terminal results               -> state.data.results.*
```

State v2 must include:

```text
stateVersion: "flow5-state-v2"
```

## Refs

```text
ROUTE.ref            -> $.data.*
EFFECT.inputRef      -> $.input* or $.data*
TERMINAL.resultRef   -> $.data.results.*
Dataflow write.ref   -> $.data.*
```

Object input refs are removed. Composite inputs should be built by `PROCESS/DATA` artifacts.

## Post-WAIT Bridge

Do not persist runtime `waitResult` projections. Domain fields named `waitResult` inside `input` or `data` may stay if they are part of the business payload. The first `PROCESS/DATA` after a WAIT may read:

```text
$.steps.<sourceEffectStepId>.latest.command.*
$.steps.<sourceEffectStepId>.latest.subflow.*
```

That DATA step should normalize the external result into `$.data.*`; downstream steps should not keep reading `$.steps.*`.

## Terminal

`reduce(TERMINAL, state, null)` remains the canonical terminal finalization call. Transitions into terminal steps may also be finalized by reducing the previous step.
