import { describe, it, expect } from 'vitest';
import { prepareFlow, validateFlow, createProcessState, plan, reduce } from '../src/index.js';

const STATIC_FLOW = {
  id: 'test.static',
  version: '1.0.0',
  entryStepId: 'finish',
  steps: {
    finish: {
      id: 'finish',
      type: 'TERMINAL' as const,
      subtype: 'FAIL' as const,
      result: { status: 'FAIL' as const, outcome: 'STATIC_REJECT' },
    },
  },
};

const DYNAMIC_FLOW = {
  id: 'test.dynamic',
  version: '1.0.0',
  entryStepId: 'prepare',
  steps: {
    prepare: {
      id: 'prepare',
      type: 'PROCESS' as const,
      subtype: 'MAPPINGS' as const,
      artefactId: 'some.mapping',
      contract: {
        input: { ref: '$.context.input' },
        output: { ref: '$.context.facts.dynamicResult' },
      },
      nextStepId: 'finish',
    },
    finish: {
      id: 'finish',
      type: 'TERMINAL' as const,
      subtype: 'FAIL' as const,
      resultRef: '$.context.facts.dynamicResult',
    },
  },
};

describe('TERMINAL resultRef', () => {
  it('static result still works as before', () => {
    const flow = prepareFlow(STATIC_FLOW);
    const state = createProcessState({ flow, processId: 'p1' });
    expect(state.status).toBe('FAIL');
    expect(state.result?.outcome).toBe('STATIC_REJECT');
  });

  it('validates: resultRef must be non-empty string', () => {
    const result = validateFlow({
      ...DYNAMIC_FLOW,
      steps: {
        ...DYNAMIC_FLOW.steps,
        finish: { ...DYNAMIC_FLOW.steps.finish, resultRef: '' },
      },
    } as any);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.code === 'FLOW_TERMINAL_RESULT_INVALID')).toBe(true);
  });

  it('validates: cannot have both result and resultRef', () => {
    const result = validateFlow({
      ...DYNAMIC_FLOW,
      steps: {
        ...DYNAMIC_FLOW.steps,
        finish: {
          ...DYNAMIC_FLOW.steps.finish,
          result: { status: 'FAIL' as const, outcome: 'BOTH' },
          resultRef: '$.context.facts.dynamicResult',
        },
      },
    } as any);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.code === 'FLOW_TERMINAL_RESULT_INVALID')).toBe(true);
  });

  it('validates: must have either result or resultRef', () => {
    const result = validateFlow({
      ...DYNAMIC_FLOW,
      steps: {
        ...DYNAMIC_FLOW.steps,
        finish: { id: 'finish', type: 'TERMINAL', subtype: 'FAIL' },
      },
    } as any);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.code === 'FLOW_TERMINAL_RESULT_INVALID')).toBe(true);
  });

  it('resolves resultRef from context.facts at runtime', () => {
    const flow = prepareFlow(DYNAMIC_FLOW);
    let state = createProcessState({ flow, processId: 'p2' });

    const step = plan(flow, state);
    expect(step.type).toBe('PROCESS');
    expect(step.id).toBe('prepare');

    // Simulate mapping output: dynamic result in facts
    const dynamicResult = {
      status: 'FAIL',
      outcome: 'VALIDATION_REJECT',
      reasonCode: 'FIELD_ERRORS',
      errors: [{ field: 'inn', message: 'ИНН невалиден' }],
    };
    state = reduce(step as any, state, dynamicResult);

    expect(state.status).toBe('FAIL');
    expect(state.result?.outcome).toBe('VALIDATION_REJECT');
    expect((state.result as any)?.reasonCode).toBe('FIELD_ERRORS');
    expect((state.result as any)?.errors).toHaveLength(1);
    expect((state.result as any)?.errors[0].field).toBe('inn');
  });

  it('throws FLOW_RESULT_REF_NOT_RESOLVED when path is missing', () => {
    const flow = prepareFlow(DYNAMIC_FLOW);
    let state = createProcessState({ flow, processId: 'p3' });

    const step = plan(flow, state);
    // Reduce without putting anything at dynamicResult path — pass null output
    expect(() => {
      state = reduce(step as any, state, null);
    }).toThrow('resultRef path is missing');
  });

  it('throws FLOW_RESULT_REF_SHAPE_INVALID when status mismatches subtype', () => {
    const flow = prepareFlow(DYNAMIC_FLOW);
    let state = createProcessState({ flow, processId: 'p4' });

    const step = plan(flow, state);
    // Wrong status — step is FAIL but result says COMPLETE
    const wrongResult = { status: 'COMPLETE', outcome: 'DONE' };
    expect(() => {
      state = reduce(step as any, state, wrongResult);
    }).toThrow('resultRef');
  });

  it('throws when outcome is missing in resultRef value', () => {
    const flow = prepareFlow(DYNAMIC_FLOW);
    let state = createProcessState({ flow, processId: 'p5' });

    const step = plan(flow, state);
    const noOutcome = { status: 'FAIL' };
    expect(() => {
      state = reduce(step as any, state, noOutcome);
    }).toThrow('resultRef');
  });
});

const DYNAMIC_FLOW_DEF = {
  id: 'test.dynamic',
  version: '1.0.0',
  entryStepId: 'prepare',
  steps: {
    prepare: {
      id: 'prepare',
      type: 'PROCESS' as const,
      subtype: 'MAPPINGS' as const,
      artefactId: 'some.mapping',
      contract: {
        input: { ref: '$.context.input' },
        output: { ref: '$.context.facts.dynamicResult' },
      },
      nextStepId: 'finish',
    },
    finish: {
      id: 'finish',
      type: 'TERMINAL' as const,
      subtype: 'FAIL' as const,
      resultRef: '$.context.facts.dynamicResult',
    },
  },
};

describe('TERMINAL resultRef — compile-time checks', () => {
  it('validateFlow rejects entry TERMINAL with resultRef', () => {
    const result = validateFlow({
      id: 'test.entry.ref',
      version: '1.0.0',
      entryStepId: 'finish',
      steps: {
        finish: {
          id: 'finish',
          type: 'TERMINAL' as const,
          subtype: 'FAIL' as const,
          resultRef: '$.context.facts.precomputed',
        },
      },
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.code === 'FLOW_TERMINAL_RESULT_INVALID')).toBe(true);
  });

  it('validateFlow rejects invalid path syntax in resultRef', () => {
    const result = validateFlow({
      ...DYNAMIC_FLOW_DEF,
      steps: {
        ...DYNAMIC_FLOW_DEF.steps,
        finish: {
          id: 'finish',
          type: 'TERMINAL' as const,
          subtype: 'FAIL' as const,
          resultRef: 'context.facts.noLeadingDollar',
        },
      },
    } as any);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.code === 'FLOW_PATH_SYNTAX_INVALID')).toBe(true);
  });
});
