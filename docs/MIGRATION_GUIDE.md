# Migration Guide — Flow 3 to Flow 5

Flow 5 is a major model rewrite. There is no compatibility mode.

## Step taxonomy

```text
PROCESS/RULES      -> PROCESS/DATA with RULES item inside dataflow artifact
PROCESS/MAPPINGS   -> PROCESS/DATA with MAPPINGS item inside dataflow artifact
PROCESS/DECISIONS  -> PROCESS/DATA with DECISIONS item inside dataflow artifact
CONTROL/SWITCH     -> CONTROL/ROUTE reading $.context.data.decisions.*.outcome
CONTROL/ROUTE.factRef -> CONTROL/ROUTE.ref
```

## State shape

```text
state.id                 -> state.flowId
state.version            -> state.flowVersion
context.checks.*         -> context.data.checks.*
context.facts.*          -> context.data.facts.*
context.decisions.*      -> context.data.decisions.*
terminal results         -> context.data.results.*
```

## Input refs

Object input refs are removed. Composite input preparation must be modeled as an explicit PROCESS/DATA payload preparation step.

## Terminal

`reduce(TERMINAL, state, null)` is the canonical terminal finalization call. Transitions into terminal steps may also be finalized by `reduce` of the previous step.
