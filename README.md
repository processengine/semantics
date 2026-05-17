# @processengine/semantics

Flow 5 process semantics for ProcessEngine.

Validates, prepares and executes flow definitions. Manages process state transitions according to the Flow 5 model.

## Flow 5 model

```
PROCESS/DATA  — synchronous data processing via dataflow artifact
CONTROL/ROUTE — routing by any scalar value from state
EFFECT        — external async call (COMMAND, CALL, SUBFLOW)
WAIT/MESSAGE  — waiting for async response
TERMINAL      — COMPLETE or FAIL
```

**Removed from Flow 5:** `PROCESS/RULES`, `PROCESS/MAPPINGS`, `PROCESS/DECISIONS`, `CONTROL/SWITCH`.

## Install

```sh
npm install @processengine/semantics
```

## Quick start

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
      id: 'evaluate', type: 'PROCESS', subtype: 'DATA',
      title: 'Evaluate', description: 'Runs a dataflow artifact.',
      artefactId: 'dataflow.example.evaluate',
      nextStepId: 'finish',
    },
    finish: {
      id: 'finish', type: 'TERMINAL', subtype: 'COMPLETE',
      title: 'Finish', description: 'Process complete.',
      result: { status: 'COMPLETE', outcome: 'DONE' },
    },
  },
};

// 1. Validate
const v = validateFlow(flowDef);
if (!v.ok) throw new Error(JSON.stringify(v.issues));

// 2. Prepare once
const flow = prepareFlow(flowDef);

// 3. Create process state
const state = createProcessState({ flow, processId: 'proc-001', input: { x: 1 } });
// state.context.data.{facts,decisions,checks,payloads,results} are all available

// 4. Orchestrator loop
const dataStep = plan(flow, state);
// dataStep.artefactId → pass to @processengine/dataflows
// dataStep contains NO input — orchestrator does not know about dataflow internals

const nextState = reduce(dataStep, state, {
  // DataflowOutput from @processengine/dataflows
  writes: [
    { ref: '$.context.data.decisions.x', value: { outcome: 'DONE' }, itemId: 'decide' },
  ],
});
// nextState.currentStepId === 'finish', status === 'COMPLETE'
```

## Orchestrator contract

```
orchestrator:
  step = plan(flow, state)           // get current step description
  output = executeStep(step, state)  // call appropriate runtime (dataflows, etc.)
  state = reduce(step, state, output)// apply output, advance to next step
  persist(state)
```

## ProcessContext

```
context.input             — process input
context.data.payloads.*   — intermediate payloads
context.data.facts.*      — decision-ready facts
context.data.decisions.*  — decision outcomes
context.data.checks.*     — rule check results
context.data.results.*    — terminal results (read by TERMINAL.resultRef)
context.effects.*         — effect responses
```

## CONTROL/ROUTE

ROUTE reads a scalar from state by `ref` path:

- String/number/boolean/null: matched against `cases` keys
- Missing ref: **runtime error** `FLOW_ROUTE_REF_NOT_RESOLVED` (missing ref is a broken dataflow contract, not a business "no match")
- Object/array: **runtime error** `FLOW_ROUTE_REF_NOT_SCALAR`
- No matching case: `defaultNextStepId`

## TERMINAL.resultRef

Must point into `$.context.data.results.*`. Written there by a PROCESS/DATA step before the terminal transition.

## See also

- `@processengine/dataflows` — executes dataflow artifacts for PROCESS/DATA steps
- `examples/` — canonical Flow 5 flow examples
