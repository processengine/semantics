import { describe, expect, it } from 'vitest';
import {
  apply,
  createProcessState,
  plan,
  prepareFlow,
  reduce,
  resume,
  validateFlow,
  XCompileError,
  XRuntimeError,
  type FlowDefinition,
} from '../src/index.js';

const canonicalFlow: FlowDefinition = {
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
      result: {
        status: 'COMPLETE',
        outcome: 'REQUEST_COMPLETED',
      },
    },
    finish_timeout: {
      id: 'finish_timeout',
      type: 'TERMINAL',
      subtype: 'FAIL',
      result: {
        status: 'FAIL',
        outcome: 'REQUEST_TIMEOUT',
      },
    },
    finish_fail: {
      id: 'finish_fail',
      type: 'TERMINAL',
      subtype: 'FAIL',
      result: {
        status: 'FAIL',
        outcome: 'REQUEST_FAILED',
      },
    },
  },
};

const switchFlow: FlowDefinition = {
  id: 'decision.processing',
  version: '2026-04-09',
  entryStepId: 'make_decision',
  steps: {
    make_decision: {
      id: 'make_decision',
      type: 'PROCESS',
      subtype: 'DECISIONS',
      artefactId: 'process.decide',
      contract: { input: { ref: '$.context.input' }, output: { ref: '$.context.decisions.review' } },
      nextStepId: 'switch_review',
    },
    switch_review: {
      id: 'switch_review',
      type: 'CONTROL',
      subtype: 'SWITCH',
      decisionSetId: 'review',
      cases: {
        CONTINUE: 'finish_complete',
        REJECT: 'finish_fail',
      },
      defaultNextStepId: 'finish_fail',
    },
    finish_complete: {
      id: 'finish_complete',
      type: 'TERMINAL',
      subtype: 'COMPLETE',
      result: {
        status: 'COMPLETE',
        outcome: 'CONTINUE',
      },
    },
    finish_fail: {
      id: 'finish_fail',
      type: 'TERMINAL',
      subtype: 'FAIL',
      result: {
        status: 'FAIL',
        outcome: 'REJECT',
      },
    },
  },
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function initState(flow = prepareFlow(canonicalFlow), processId = 'proc-001') {
  return createProcessState({
    flow,
    processId,
    input: {
      requestId: 'REQ-001',
      payload: { amount: 100 },
    },
  });
}

function advanceToEffect() {
  const flow = prepareFlow(canonicalFlow);
  let state = initState(flow);

  const rulesStep = plan(flow, state);
  if (rulesStep.type !== 'PROCESS' || rulesStep.subtype !== 'RULES') throw new Error('expected RULES');
  state = reduce(rulesStep, state, { ok: true, errors: [] });

  const mappingsStep = plan(flow, state);
  if (mappingsStep.type !== 'PROCESS' || mappingsStep.subtype !== 'MAPPINGS') throw new Error('expected MAPPINGS');
  state = reduce(mappingsStep, state, { ready: true });

  const routeStep = plan(flow, state);
  if (routeStep.type !== 'CONTROL' || routeStep.subtype !== 'ROUTE') throw new Error('expected ROUTE');
  state = reduce(routeStep, state, null);

  return { flow, state };
}

function advanceToWait() {
  const { flow, state } = advanceToEffect();
  const nextState = apply(flow, state, 'send_command', {
    requestId: 'req-001',
    result: { accepted: true },
    error: null,
    errorCode: null,
  });

  return { flow, state: nextState };
}

describe('validateFlow / prepareFlow', () => {
  it('returns the canonical ValidationResult shape for a valid flow', () => {
    const validation = validateFlow(canonicalFlow);
    expect(validation).toEqual({
      isValid: true,
      errors: [],
      warnings: [],
    });
  });

  it('produces an immutable prepared artifact separate from raw source', () => {
    const prepared = prepareFlow(canonicalFlow);
    const internal = prepared as unknown as { stepsById: Record<string, unknown> };

    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(internal.stepsById)).toBe(true);
  });

  it('rejects non-canonical root and step contracts', () => {
    const invalid = clone(canonicalFlow) as FlowDefinition & { steps: Record<string, Record<string, unknown>> };
    invalid.steps = {
      validate_input: {
        id: 'wrong_id',
        type: 'PROCESS',
        subtype: 'RULES',
        artefactId: 'process.validate',
      contract: { input: { ref: '$.context.input' }, output: { ref: '$.context.steps.validation' } },
        nextStepId: 'missing',
      },
    };

    const validation = validateFlow(invalid);
    expect(validation.isValid).toBe(false);
    expect(validation.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['FLOW_STEP_ID_MISMATCH', 'FLOW_WRITE_NAMESPACE_FORBIDDEN', 'FLOW_STEP_REF_NOT_FOUND', 'FLOW_TERMINAL_NOT_REACHABLE']),
    );
  });

  it('requires subtype for every step and all mandatory WAIT branches', () => {
    const invalid = clone(canonicalFlow) as FlowDefinition & { steps: Record<string, Record<string, unknown>> };
    delete invalid.steps.validate_input.subtype;
    delete invalid.steps.wait_response.onTimeoutStepId;

    const validation = validateFlow(invalid);
    expect(validation.isValid).toBe(false);
    expect(validation.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['FLOW_REQUIRED_FIELD_MISSING', 'FLOW_WAIT_BRANCH_MISSING']),
    );
  });

  it('requires operationId on EFFECT and rejects artefactId there', () => {
    const invalid = clone(canonicalFlow) as FlowDefinition & { steps: Record<string, Record<string, unknown>> };
    invalid.steps.send_command = {
      ...invalid.steps.send_command,
      artefactId: 'effect.legacy',
    };
    delete invalid.steps.send_command.operationId;

    const validation = validateFlow(invalid);
    expect(validation.isValid).toBe(false);
    expect(validation.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['FLOW_REQUIRED_FIELD_MISSING', 'FLOW_FIELD_FORBIDDEN']),
    );
  });

  it('throws XCompileError when prepareFlow is called on invalid source', () => {
    expect(() =>
      prepareFlow({
        id: 'broken',
        version: '2026-04-09',
        entryStepId: 'start',
        steps: {},
      }),
    ).toThrowError(XCompileError);
  });
});

describe('runtime semantics', () => {
  it('plans executable PROCESS with subtype and resolved input', () => {
    const flow = prepareFlow(canonicalFlow);
    const state = initState(flow);

    const step = plan(flow, state);
    expect(step).toMatchObject({
      id: 'validate_input',
      type: 'PROCESS',
      subtype: 'RULES',
      artefactId: 'process.validate',
      input: {
        requestId: 'REQ-001',
        payload: { amount: 100 },
      },
    });
    expect(state.status).toBe('ACTIVE');
  });

  it('reduce writes executable output into allowed namespace and advances to next step', () => {
    const flow = prepareFlow(canonicalFlow);
    let state = initState(flow);

    const step = plan(flow, state);
    if (step.type !== 'PROCESS' || step.subtype !== 'RULES') throw new Error('expected RULES');
    state = reduce(step, state, { ok: true, errors: [] });

    expect(state.context.checks.validation).toEqual({ ok: true, errors: [] });
    expect(state.currentStepId).toBe('map_validation');
    expect(state.currentStepSubtype).toBe('MAPPINGS');
  });

  it('ROUTE is resolved internally and carries only selectedNextStepId', () => {
    const { flow, state } = advanceToEffect();
    const beforeEffect = clone(state);

    expect(beforeEffect.currentStepId).toBe('send_command');
    expect(beforeEffect.currentStepType).toBe('EFFECT');
  });

  it('EFFECT uses operationId and apply enters WAITING without correlationKey', () => {
    const { flow, state } = advanceToEffect();
    const effectStep = plan(flow, state);
    if (effectStep.type !== 'EFFECT') throw new Error('expected EFFECT');

    expect(effectStep).toEqual({
      id: 'send_command',
      type: 'EFFECT',
      subtype: 'COMMAND',
      operationId: 'remote.submit',
      input: {
        requestId: 'REQ-001',
        payload: { amount: 100 },
      },
    });

    const nextState = apply(flow, state, 'send_command', {
      requestId: 'req-001',
      result: { accepted: true },
      error: null,
      errorCode: null,
    });

    expect(nextState.status).toBe('WAITING');
    expect(nextState.currentStepId).toBe('wait_response');
    expect(nextState.currentStepSubtype).toBe('MESSAGE');
    expect(nextState.context.effects.send_command).toEqual({
      requestId: 'req-001',
      result: { accepted: true },
      error: null,
      errorCode: null,
    });
  });

  it('resume preserves WAIT startedAt and completes through terminal transition', () => {
    const { flow, state } = advanceToWait();
    const waitStartedAt = state.context.steps.wait_response?.startedAt;

    const nextState = resume(flow, state, 'wait_response', {
      requestId: 'req-001',
      result: { delivered: true },
      error: null,
      errorCode: null,
    });

    expect(nextState.status).toBe('COMPLETE');
    expect(nextState.result).toEqual({
      status: 'COMPLETE',
      outcome: 'REQUEST_COMPLETED',
    });
    expect(nextState.context.effects.send_command).toEqual({
      requestId: 'req-001',
      result: { accepted: true },
      error: null,
      errorCode: null,
      waitResult: {
        requestId: 'req-001',
        result: { delivered: true },
        error: null,
        errorCode: null,
      },
    });
    expect(nextState.context.steps.wait_response?.startedAt).toBe(waitStartedAt);
    expect(nextState.context.steps.wait_response?.finishedAt).not.toBeNull();
  });

  it('rejects mixed result payloads as runtime contract violations', () => {
    const { flow, state } = advanceToEffect();

    expect(() =>
      apply(flow, state, 'send_command', {
        requestId: 'req-001',
        result: { accepted: true },
        error: { code: 'E_REMOTE' },
        errorCode: 'E_REMOTE',
      }),
    ).toThrowError(XRuntimeError);

    try {
      apply(flow, state, 'send_command', {
        requestId: 'req-001',
        result: { accepted: true },
        error: { code: 'E_REMOTE' },
        errorCode: 'E_REMOTE',
      });
    } catch (error) {
      expect((error as XRuntimeError).code).toBe('FLOW_MIXED_RESULT');
    }
  });

  it('treats missing factRef path as runtime contract violation', () => {
    const flow = prepareFlow(canonicalFlow);
    let state = initState(flow);

    const rulesStep = plan(flow, state);
    if (rulesStep.type !== 'PROCESS' || rulesStep.subtype !== 'RULES') throw new Error('expected RULES');
    state = reduce(rulesStep, state, { ok: true, errors: [] });

    const mappingsStep = plan(flow, state);
    if (mappingsStep.type !== 'PROCESS' || mappingsStep.subtype !== 'MAPPINGS') throw new Error('expected MAPPINGS');
    state = reduce(mappingsStep, state, {});

    expect(() => plan(flow, state)).toThrowError(XRuntimeError);

    try {
      plan(flow, state);
    } catch (error) {
      expect((error as XRuntimeError).code).toBe('FLOW_PATH_NOT_RESOLVED');
    }
  });

  it('treats missing SWITCH outcome as runtime contract violation', () => {
    const flow = prepareFlow(switchFlow);
    let state = createProcessState({
      flow,
      processId: 'proc-switch',
      input: { requestId: 'REQ-SWITCH' },
    });

    const decisionStep = plan(flow, state);
    if (decisionStep.type !== 'PROCESS' || decisionStep.subtype !== 'DECISIONS') throw new Error('expected DECISIONS');
    state = reduce(decisionStep, state, {});

    expect(() => plan(flow, state)).toThrowError(XRuntimeError);

    try {
      plan(flow, state);
    } catch (error) {
      expect((error as XRuntimeError).code).toBe('FLOW_DECISION_NOT_RESOLVED');
    }
  });

  it('uses ACTIVE instead of RUNNING and forbids runtime calls on terminal state', () => {
    const { flow, state } = advanceToWait();
    const doneState = resume(flow, state, 'wait_response', {
      requestId: 'req-001',
      result: { delivered: true },
      error: null,
      errorCode: null,
    });

    expect(doneState.status).toBe('COMPLETE');
    expect(() => plan(flow, doneState)).toThrowError(XRuntimeError);

    try {
      plan(flow, doneState);
    } catch (error) {
      expect((error as XRuntimeError).code).toBe('FLOW_TERMINAL_MISUSED');
    }
  });
});

describe('EFFECT/SUBFLOW DSL and normalization', () => {
  const subflowFlow: FlowDefinition = {
    id: 'parent.flow',
    version: '2026-04-10',
    entryStepId: 'run_child',
    steps: {
      run_child: {
        id: 'run_child',
        type: 'EFFECT',
        subtype: 'SUBFLOW',
        operationId: 'launch-child-process',
        flowId: 'child.flow',
        flowVersion: '2026-04-10',
        inputRef: '$.context.input',
        nextStepId: 'wait_child',
        onErrorStepId: 'finish_fail',
        onTimeoutStepId: 'finish_timeout',
      },
      wait_child: {
        id: 'wait_child',
        type: 'WAIT',
        subtype: 'MESSAGE',
        sourceStepId: 'run_child',
        nextStepId: 'finish_ok',
        onErrorStepId: 'finish_fail',
        onTimeoutStepId: 'finish_timeout',
      },
      finish_ok: {
        id: 'finish_ok',
        type: 'TERMINAL',
        subtype: 'COMPLETE',
        result: { status: 'COMPLETE', outcome: 'CHILD_SUCCEEDED' },
      },
      finish_fail: {
        id: 'finish_fail',
        type: 'TERMINAL',
        subtype: 'FAIL',
        result: { status: 'FAIL', outcome: 'CHILD_FAILED' },
      },
      finish_timeout: {
        id: 'finish_timeout',
        type: 'TERMINAL',
        subtype: 'FAIL',
        result: { status: 'FAIL', outcome: 'CHILD_TIMEOUT' },
      },
    },
  };

  it('validates a canonical EFFECT/SUBFLOW flow', () => {
    const result = validateFlow(subflowFlow);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects SUBFLOW missing flowId', () => {
    const invalid = clone(subflowFlow) as FlowDefinition & { steps: Record<string, Record<string, unknown>> };
    delete invalid.steps['run_child']['flowId'];
    const result = validateFlow(invalid);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.path?.includes('flowId'))).toBe(true);
  });

  it('rejects SUBFLOW missing flowVersion', () => {
    const invalid = clone(subflowFlow) as FlowDefinition & { steps: Record<string, Record<string, unknown>> };
    delete invalid.steps['run_child']['flowVersion'];
    const result = validateFlow(invalid);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.path?.includes('flowVersion'))).toBe(true);
  });

  it('rejects SUBFLOW with forbidden artefactId field', () => {
    const invalid = clone(subflowFlow) as FlowDefinition & { steps: Record<string, Record<string, unknown>> };
    invalid.steps['run_child']['artefactId'] = 'some.artefact';
    const result = validateFlow(invalid);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.code === 'FLOW_FIELD_FORBIDDEN')).toBe(true);
  });

  it('rejects SUBFLOW with forbidden outputRef field', () => {
    const invalid = clone(subflowFlow) as FlowDefinition & { steps: Record<string, Record<string, unknown>> };
    invalid.steps['run_child']['outputRef'] = '$.context.facts.result';
    const result = validateFlow(invalid);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.code === 'FLOW_FIELD_FORBIDDEN')).toBe(true);
  });

  it('plan materializes flowId and flowVersion in normalized SUBFLOW step', () => {
    const flow = prepareFlow(subflowFlow);
    const state = createProcessState({ flow, processId: 'proc-subflow', input: { data: 1 } });
    const step = plan(flow, state);
    expect(step.type).toBe('EFFECT');
    expect(step.subtype).toBe('SUBFLOW');
    if (step.type !== 'EFFECT' || step.subtype !== 'SUBFLOW') throw new Error('unexpected');
    expect(step.flowId).toBe('child.flow');
    expect(step.flowVersion).toBe('2026-04-10');
    expect(step.operationId).toBe('launch-child-process');
  });

  it('apply transitions parent to WAITING after SUBFLOW dispatch', () => {
    const flow = prepareFlow(subflowFlow);
    const state = createProcessState({ flow, processId: 'proc-subflow-wait', input: {} });
    const step = plan(flow, state);
    if (step.type !== 'EFFECT') throw new Error('expected EFFECT');
    const nextState = apply(flow, state, step.id, {
      requestId: 'proc_child_001',
      result: { launched: true },
      error: null,
      errorCode: null,
    });
    expect(nextState.status).toBe('WAITING');
    expect(nextState.currentStepId).toBe('wait_child');
    expect((nextState.context.effects['run_child'] as Record<string, unknown>)?.requestId).toBe('proc_child_001');
  });
  it('plan materializes operationId in normalized WAIT step from source EFFECT step', () => {
    const flow = prepareFlow(subflowFlow);
    let state = createProcessState({ flow, processId: 'proc-wait-opid', input: {} });

    // advance to WAITING via apply
    const effectStep = plan(flow, state);
    if (effectStep.type !== 'EFFECT') throw new Error('expected EFFECT');
    state = apply(flow, state, effectStep.id, {
      requestId: 'req-opid-001',
      result: { launched: true },
      error: null,
      errorCode: null,
    });
    expect(state.status).toBe('WAITING');

    // plan on WAITING state returns WAIT with operationId
    const waitStep = plan(flow, state);
    expect(waitStep.type).toBe('WAIT');
    if (waitStep.type !== 'WAIT') throw new Error('expected WAIT');
    expect(waitStep.operationId).toBe('launch-child-process');
    expect(waitStep.requestId).toBe('req-opid-001');
  });

});
