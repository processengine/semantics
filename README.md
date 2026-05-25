# @processengine/semantics

Flow 5 process semantics for ProcessEngine.

The package validates Flow 5 artifacts, prepares them for runtime, and applies lifecycle transitions over State v2.

## Flow 5 Model

```text
PROCESS/DATA  -> synchronous data assessment through @processengine/dataflows
CONTROL/ROUTE -> routing by a scalar from $.data.*
EFFECT        -> external COMMAND/SUBFLOW async lifecycle or synchronous CALL
WAIT/MESSAGE  -> wait for an EFFECT result
TERMINAL      -> COMPLETE or FAIL
```

Removed from Flow 5: `PROCESS/RULES`, `PROCESS/MAPPINGS`, `PROCESS/DECISIONS`, `CONTROL/SWITCH`, `factRef`.

`CALL` is synchronous: it must complete in `apply(...)` and must not transition to `WAIT/MESSAGE`. Use `COMMAND` or `SUBFLOW` for asynchronous external lifecycle.

## Install

```sh
npm install @processengine/semantics
```

## Quick Start

```js
import { validateFlow, prepareFlow, createProcessState, plan, reduce } from '@processengine/semantics';

const flowDef = {
  id: 'flow.example',
  version: '1.0.0',
  title: 'Example flow',
  description: 'Minimal Flow 5 process.',
  entryStepId: 'evaluate',
  steps: {
    evaluate: {
      id: 'evaluate',
      type: 'PROCESS',
      subtype: 'DATA',
      title: 'Evaluate',
      description: 'Runs a dataflow artifact.',
      artefactId: 'dataflow.example.evaluate',
      nextStepId: 'route',
    },
    route: {
      id: 'route',
      type: 'CONTROL',
      subtype: 'ROUTE',
      title: 'Route',
      description: 'Routes by dataflow decision.',
      ref: '$.data.decisions.x.outcome',
      cases: { DONE: 'finish' },
      defaultNextStepId: 'finish',
    },
    finish: {
      id: 'finish',
      type: 'TERMINAL',
      subtype: 'COMPLETE',
      title: 'Finish',
      description: 'Process complete.',
      resultRef: '$.data.results.done',
    },
  },
};

const validation = validateFlow(flowDef);
if (!validation.ok) throw new Error(JSON.stringify(validation.issues));

const flow = prepareFlow(flowDef);
let state = createProcessState({ flow, processId: 'proc-001', input: { x: 1 } });

const dataStep = plan(flow, state);
state = reduce(dataStep, state, {
  writes: [
    { ref: '$.data.decisions.x', value: { outcome: 'DONE' }, itemId: 'decide' },
    { ref: '$.data.results.done', value: { status: 'COMPLETE', outcome: 'DONE' }, itemId: 'result' },
  ],
});

const routeStep = plan(flow, state);
state = reduce(routeStep, state, null);
```

## State v2 Shape

```text
state.input             -> process input
state.data.payloads.*   -> intermediate payloads
state.data.facts.*      -> decision-ready facts
state.data.decisions.*  -> decision outcomes
state.data.checks.*     -> rule check results
state.data.results.*    -> terminal results
state.steps.*           -> step execution records
state.timeline[]        -> minimal execution timeline
```

There is no persisted `context`, `history`, `context.effects`, or runtime `waitResult` projection in State v2. Domain payload fields named `waitResult` inside `input` or `data` are allowed. Even with `trace: 'off'`, `PROCESS/DATA` write values stay in `dataflow.writes[]` as the audit projection.

## EFFECT / WAIT Results

EFFECT executions are stored under `state.steps.<effectStepId>.executions[]`.

The virtual path segment `latest` resolves through `latestExecutionId`:

```text
$.steps.send_client.latest.command.result
$.steps.run_child.latest.subflow.result
```

Only the first `PROCESS/DATA` after a `WAIT/MESSAGE` should read these paths. That bridge DATA step normalizes external response data into `$.data.*`.

## TERMINAL.resultRef

`TERMINAL.resultRef` must point into `$.data.results.*`.

## See Also

- `SPEC.md` and `SPEC_RU.md` for the normative contract.
- `@processengine/dataflows` for `PROCESS/DATA` execution.
- `examples/` for canonical Flow 5 artifacts.
