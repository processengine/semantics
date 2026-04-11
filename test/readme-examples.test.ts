import { describe, expect, it } from 'vitest';
import {
  apply,
  createProcessState,
  formatValidationIssues,
  plan,
  prepareFlow,
  reduce,
  resume,
  validateFlow,
  type FlowDefinition,
} from '../src/index.js';

const quickStartFlow: FlowDefinition = {
  id: 'request.processing',
  version: '2026-04-09',
  entryStepId: 'validate_input',
  steps: {
    validate_input: {
      id: 'validate_input',
      type: 'PROCESS',
      subtype: 'RULES',
      artefactId: 'process.validate',
      contract: { input: { ref: '$.context.input' }, output: { ref: '$.context.checks.validation' } },
      nextStepId: 'map_validation',
    },
    map_validation: {
      id: 'map_validation',
      type: 'PROCESS',
      subtype: 'MAPPINGS',
      artefactId: 'process.mapValidation',
      contract: { input: { ref: '$.context.checks.validation' }, output: { ref: '$.context.facts.validation' } },
      nextStepId: 'route_validation',
    },
    route_validation: {
      id: 'route_validation',
      type: 'CONTROL',
      subtype: 'ROUTE',
      factRef: '$.context.facts.validation.ready',
      cases: {
        true: 'send_command',
        false: 'finish_fail',
      },
      defaultNextStepId: 'finish_fail',
    },
    send_command: {
      id: 'send_command',
      type: 'EFFECT',
      subtype: 'COMMAND',
      operationId: 'remote.submit',
      inputRef: '$.context.input',
      nextStepId: 'wait_response',
      onErrorStepId: 'finish_fail',
    },
    wait_response: {
      id: 'wait_response',
      type: 'WAIT',
      subtype: 'MESSAGE',
      sourceStepId: 'send_command',
      nextStepId: 'finish_complete',
      onErrorStepId: 'finish_fail',
      onTimeoutStepId: 'finish_timeout',
    },
    finish_complete: {
      id: 'finish_complete',
      type: 'TERMINAL',
      subtype: 'COMPLETE',
      result: { status: 'COMPLETE', outcome: 'REQUEST_COMPLETED' },
    },
    finish_timeout: {
      id: 'finish_timeout',
      type: 'TERMINAL',
      subtype: 'FAIL',
      result: { status: 'FAIL', outcome: 'REQUEST_TIMEOUT' },
    },
    finish_fail: {
      id: 'finish_fail',
      type: 'TERMINAL',
      subtype: 'FAIL',
      result: { status: 'FAIL', outcome: 'REQUEST_FAILED' },
    },
  },
};

describe('README quick start', () => {
  it('validates, prepares, and reaches terminal completion through the documented lifecycle', () => {
    const validation = validateFlow(quickStartFlow);
    expect(validation.isValid).toBe(true);
    expect(() => {
      if (!validation.isValid) throw new Error(formatValidationIssues(validation.errors));
    }).not.toThrow();

    const preparedFlow = prepareFlow(quickStartFlow);

    let state = createProcessState({
      flow: preparedFlow,
      processId: 'proc_001',
      input: {
        requestId: 'REQ-001',
        payload: { amount: 100 },
      },
    });

    let step = plan(preparedFlow, state);
    if (step.type !== 'PROCESS' || step.subtype !== 'RULES') throw new Error('Expected RULES');
    state = reduce(step, state, { ok: true, errors: [] });

    step = plan(preparedFlow, state);
    if (step.type !== 'PROCESS' || step.subtype !== 'MAPPINGS') throw new Error('Expected MAPPINGS');
    state = reduce(step, state, { ready: true });

    step = plan(preparedFlow, state);
    if (step.type !== 'CONTROL' || step.subtype !== 'ROUTE') throw new Error('Expected ROUTE');
    state = reduce(step, state, null);

    step = plan(preparedFlow, state);
    if (step.type !== 'EFFECT') throw new Error('Expected EFFECT');
    state = apply(preparedFlow, state, step.id, {
      requestId: 'req-001',
      result: { accepted: true },
      error: null,
      errorCode: null,
    });

    step = plan(preparedFlow, state);
    if (step.type !== 'WAIT') throw new Error('Expected WAIT');
    state = resume(preparedFlow, state, step.id, {
      requestId: 'req-001',
      result: { delivered: true },
      error: null,
      errorCode: null,
    });

    expect(state.status).toBe('COMPLETE');
    expect(state.result).toEqual({
      status: 'COMPLETE',
      outcome: 'REQUEST_COMPLETED',
    });
  });
});
