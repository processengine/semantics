import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  plan,
  prepareFlow,
  reduce,
  validateFlow,
} from '../dist/index.js';
import { createProcessState } from '../dist/runtime/index.js';

const mediumFlow = {
  id: 'benchmark.medium',
  version: '2026-04-09',
  entryStepId: 'validate',
  steps: {
    validate: {
      id: 'validate',
      type: 'PROCESS',
      subtype: 'RULES',
      artefactId: 'process.validate',
      inputRef: '$.context.input',
      outputRef: '$.context.checks.validation',
      nextStepId: 'map_validation',
    },
    map_validation: {
      id: 'map_validation',
      type: 'PROCESS',
      subtype: 'MAPPINGS',
      artefactId: 'process.mapValidation',
      inputRef: '$.context.checks.validation',
      outputRef: '$.context.facts.validation',
      nextStepId: 'route_validation',
    },
    route_validation: {
      id: 'route_validation',
      type: 'PROCESS',
      subtype: 'ROUTE',
      factRef: '$.context.facts.validation.ready',
      cases: {
        true: 'finish_complete',
        false: 'finish_fail',
      },
      defaultNextStepId: 'finish_fail',
    },
    finish_complete: {
      id: 'finish_complete',
      type: 'TERMINAL',
      subtype: 'COMPLETE',
      result: {
        status: 'COMPLETE',
        outcome: 'DONE',
      },
    },
    finish_fail: {
      id: 'finish_fail',
      type: 'TERMINAL',
      subtype: 'FAIL',
      result: {
        status: 'FAIL',
        outcome: 'DECLINED',
      },
    },
  },
};

const linearFlow = {
  id: 'benchmark.linear',
  version: '2026-04-09',
  entryStepId: 'step1',
  steps: {
    step1: {
      id: 'step1',
      type: 'PROCESS',
      subtype: 'MAPPINGS',
      artefactId: 'process.step1',
      inputRef: '$.context.input',
      outputRef: '$.context.facts.a',
      nextStepId: 'step2',
    },
    step2: {
      id: 'step2',
      type: 'PROCESS',
      subtype: 'MAPPINGS',
      artefactId: 'process.step2',
      inputRef: '$.context.facts.a',
      outputRef: '$.context.facts.b',
      nextStepId: 'step3',
    },
    step3: {
      id: 'step3',
      type: 'PROCESS',
      subtype: 'MAPPINGS',
      artefactId: 'process.step3',
      inputRef: '$.context.facts.b',
      outputRef: '$.context.facts.c',
      nextStepId: 'finish',
    },
    finish: {
      id: 'finish',
      type: 'TERMINAL',
      subtype: 'COMPLETE',
      result: {
        status: 'COMPLETE',
        outcome: 'DONE',
      },
    },
  },
};

function report(name, count, elapsedMs) {
  const opsPerSec = (count / (elapsedMs / 1000)).toFixed(0);
  const avgMs = (elapsedMs / count).toFixed(4);
  console.log(`${name}: ${count} ops in ${elapsedMs.toFixed(2)} ms | ${opsPerSec} ops/s | avg ${avgMs} ms/op`);
}

function bench(name, count, fn) {
  const start = performance.now();
  for (let i = 0; i < count; i += 1) fn();
  const end = performance.now();
  report(name, count, end - start);
}

function runLinearFlow(preparedFlow) {
  let state = createProcessState({
    flow: preparedFlow,
    processId: crypto.randomUUID(),
    input: { amount: 100, currency: 'RUB' },
  });

  while (state.status === 'ACTIVE') {
    const step = plan(preparedFlow, state);
    if (step.type !== 'PROCESS' || step.subtype !== 'MAPPINGS') {
      throw new Error(`Unexpected benchmark step: ${step.type}/${step.subtype}`);
    }
    state = reduce(step, state, {
      stepId: step.id,
      input: step.input,
    });
  }

  return state;
}

const preparedLinear = prepareFlow(linearFlow);

bench('validateFlow(medium)', 1000, () => {
  validateFlow(mediumFlow);
});

bench('prepareFlow(medium)', 500, () => {
  prepareFlow(mediumFlow);
});

bench('plan+reduce(linear full run)', 1000, () => {
  runLinearFlow(preparedLinear);
});
