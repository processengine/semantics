import { describe, it, expect } from 'vitest';
import {
  validateFlow,
  prepareFlow,
  createProcessState,
  plan,
  reduce,
  apply,
  resume,
  XRuntimeError,
} from '../src/index.js';

// ── Canonical Flow 5 fixture ───────────────────────────────────────────────────
// All tests use this as the base, patching only what they need to test.

const base = {
  id: 'flow.test',
  version: '1.0.0',
  title: 'Тестовый Flow 5 процесс',
  description: 'Базовый процесс для unit-тестирования Flow 5 семантики.',
  entryStepId: 'evaluate',
  steps: {
    evaluate: {
      id: 'evaluate', type: 'PROCESS', subtype: 'DATA',
      title: 'Оценить данные', description: 'Запускает dataflow для принятия решения.',
      artefactId: 'dataflow.test.evaluate',
      nextStepId: 'route',
    },
    route: {
      id: 'route', type: 'CONTROL', subtype: 'ROUTE',
      title: 'Маршрутизировать', description: 'Выбирает ветку по исходу dataflow.',
      ref: '$.data.decisions.validation.outcome',
      cases: { CONTINUE: 'finish_ok', REJECT: 'finish_fail' },
      defaultNextStepId: 'finish_fail',
    },
    finish_ok: {
      id: 'finish_ok', type: 'TERMINAL', subtype: 'COMPLETE',
      title: 'Завершить успешно', description: 'Фиксирует успешный результат.',
      resultRef: '$.data.results.success',
    },
    finish_fail: {
      id: 'finish_fail', type: 'TERMINAL', subtype: 'FAIL',
      title: 'Завершить отказом', description: 'Фиксирует отказной результат.',
      result: { status: 'FAIL', outcome: 'REJECTED' },
    },
  },
} as const;

// ── validateFlow — taxonomy ───────────────────────────────────────────────────

describe('validateFlow — Flow 5 taxonomy', () => {
  it('accepts canonical Flow 5 flow', () => {
    expect(validateFlow(base).ok).toBe(true);
  });

  it('rejects PROCESS/RULES — removed in Flow 5', () => {
    const r = validateFlow({ ...base, steps: { ...base.steps, evaluate: { ...base.steps.evaluate, subtype: 'RULES' } } });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'FLOW_INVALID_SUBTYPE')).toBe(true);
  });

  it('rejects PROCESS/MAPPINGS — removed in Flow 5', () => {
    const r = validateFlow({ ...base, steps: { ...base.steps, evaluate: { ...base.steps.evaluate, subtype: 'MAPPINGS' } } });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'FLOW_INVALID_SUBTYPE')).toBe(true);
  });

  it('rejects PROCESS/DECISIONS — removed in Flow 5', () => {
    const r = validateFlow({ ...base, steps: { ...base.steps, evaluate: { ...base.steps.evaluate, subtype: 'DECISIONS' } } });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'FLOW_INVALID_SUBTYPE')).toBe(true);
  });

  it('rejects CONTROL/SWITCH — removed in Flow 5', () => {
    const r = validateFlow({ ...base, steps: { ...base.steps, route: { ...base.steps.route, subtype: 'SWITCH' } } });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'FLOW_INVALID_SUBTYPE')).toBe(true);
  });

  it('rejects PROCESS/DATA with contract field', () => {
    const r = validateFlow({ ...base, steps: { ...base.steps, evaluate: { ...base.steps.evaluate, contract: {} } } });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'FLOW_DATA_STEP_FORBIDDEN_FIELD')).toBe(true);
  });

  it('rejects PROCESS/DATA with onErrorStepId', () => {
    const r = validateFlow({ ...base, steps: { ...base.steps, evaluate: { ...base.steps.evaluate, onErrorStepId: 'finish_fail' } } });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'FLOW_DATA_STEP_FORBIDDEN_FIELD')).toBe(true);
  });

  it('rejects PROCESS/DATA without artefactId', () => {
    const { artefactId, ...noId } = base.steps.evaluate as any;
    const r = validateFlow({ ...base, steps: { ...base.steps, evaluate: noId } });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'FLOW_DATA_ARTEFACT_MISSING')).toBe(true);
  });

  it('rejects CONTROL/ROUTE with factRef — renamed to ref in Flow 5', () => {
    const { ref, ...noRef } = base.steps.route as any;
    const r = validateFlow({ ...base, steps: { ...base.steps, route: { ...noRef, factRef: '$.data.decisions.x.outcome' } } });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'FLOW_ROUTE_FACTREF_REMOVED')).toBe(true);
  });

  it('rejects CONTROL/ROUTE without ref', () => {
    const { ref, ...noRef } = base.steps.route as any;
    const r = validateFlow({ ...base, steps: { ...base.steps, route: noRef } });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'FLOW_ROUTE_REF_MISSING')).toBe(true);
  });

  it('rejects TERMINAL resultRef outside $.data.results.*', () => {
    const r = validateFlow({ ...base, steps: { ...base.steps, finish_ok: { ...base.steps.finish_ok, resultRef: '$.data.facts.result' } } });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'FLOW_TERMINAL_RESULTREF_INVALID')).toBe(true);
  });

  it('rejects TERMINAL static result.status not matching subtype', () => {
    const r = validateFlow({ ...base, steps: { ...base.steps, finish_fail: { ...base.steps.finish_fail, result: { status: 'COMPLETE', outcome: 'BAD' } } } });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'FLOW_TERMINAL_RESULT_STATUS_MISMATCH')).toBe(true);
  });

  it('rejects missing title on flow', () => {
    const { title, ...noTitle } = base as any;
    expect(validateFlow(noTitle).ok).toBe(false);
    expect(validateFlow(noTitle).issues.some(i => i.code === 'FLOW_TITLE_MISSING')).toBe(true);
  });

  it('rejects missing title on step', () => {
    const { title, ...noTitle } = base.steps.evaluate as any;
    const r = validateFlow({ ...base, steps: { ...base.steps, evaluate: noTitle } });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'FLOW_STEP_TITLE_MISSING')).toBe(true);
  });

  it('rejects object inputRef on EFFECT — removed in Flow 5', () => {
    const withEffect = {
      ...base,
      steps: {
        ...base.steps,
        call_abs: {
          id: 'call_abs', type: 'EFFECT', subtype: 'CALL',
          title: 'Вызов АБС', description: 'Отправляет запрос в АБС.',
          operationId: 'abs.findClient',
          inputRef: { a: '$.input.application' } as any,
          nextStepId: 'evaluate',
          onErrorStepId: 'finish_fail',
        },
      },
    };
    const r = validateFlow(withEffect);
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'FLOW_OBJECT_INPUTREF_REMOVED')).toBe(true);
  });
});

// ── validateFlow — transition refs ────────────────────────────────────────────

describe('validateFlow — transition refs exist', () => {
  it('rejects DATA nextStepId pointing to non-existent step', () => {
    const r = validateFlow({ ...base, steps: { ...base.steps, evaluate: { ...base.steps.evaluate, nextStepId: 'NOPE' } } });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'FLOW_TRANSITION_NOT_FOUND')).toBe(true);
  });

  it('rejects ROUTE case pointing to non-existent step', () => {
    const r = validateFlow({ ...base, steps: { ...base.steps, route: { ...base.steps.route, cases: { CONTINUE: 'NOPE' } } } });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'FLOW_TRANSITION_NOT_FOUND')).toBe(true);
  });

  it('rejects ROUTE defaultNextStepId pointing to non-existent step', () => {
    const r = validateFlow({ ...base, steps: { ...base.steps, route: { ...base.steps.route, defaultNextStepId: 'NOPE' } } });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'FLOW_TRANSITION_NOT_FOUND')).toBe(true);
  });
});

// ── validateFlow — graph integrity ───────────────────────────────────────────

describe('validateFlow — graph integrity', () => {
  it('rejects orphan steps that are not reachable from entryStepId', () => {
    const r = validateFlow({
      ...base,
      steps: {
        ...base.steps,
        orphan: {
          id: 'orphan', type: 'PROCESS', subtype: 'DATA',
          title: 'Orphan', description: 'Unreachable technical step.',
          artefactId: 'dataflow.test.orphan', nextStepId: 'finish_fail',
        },
      },
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'FLOW_UNREACHABLE_STEP' && i.path === 'steps.orphan')).toBe(true);
  });

  it('rejects flows without any TERMINAL step', () => {
    const r = validateFlow({
      ...base,
      entryStepId: 'evaluate',
      steps: {
        evaluate: { ...base.steps.evaluate, nextStepId: 'route' },
        route: {
          ...base.steps.route,
          cases: { CONTINUE: 'evaluate' },
          defaultNextStepId: 'evaluate',
        },
      },
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'FLOW_TERMINAL_MISSING')).toBe(true);
  });

  it('rejects flows where no TERMINAL is reachable from entryStepId', () => {
    const r = validateFlow({
      ...base,
      steps: {
        ...base.steps,
        evaluate: { ...base.steps.evaluate, nextStepId: 'loop' },
        loop: {
          id: 'loop', type: 'PROCESS', subtype: 'DATA',
          title: 'Loop', description: 'Loops forever.',
          artefactId: 'dataflow.test.loop', nextStepId: 'loop',
        },
      },
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'FLOW_TERMINAL_NOT_REACHABLE')).toBe(true);
    expect(r.issues.some(i => i.code === 'FLOW_SELF_LOOP_FORBIDDEN')).toBe(true);
  });

  it('rejects self-loop transitions', () => {
    const r = validateFlow({
      ...base,
      steps: { ...base.steps, evaluate: { ...base.steps.evaluate, nextStepId: 'evaluate' } },
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'FLOW_SELF_LOOP_FORBIDDEN')).toBe(true);
  });

  it('rejects graph cycles while cycle support is outside the Flow 5 runtime scope', () => {
    const r = validateFlow({
      ...base,
      steps: {
        ...base.steps,
        evaluate: { ...base.steps.evaluate, nextStepId: 'derive' },
        derive: {
          id: 'derive', type: 'PROCESS', subtype: 'DATA',
          title: 'Derive', description: 'Forms a cycle with evaluate.',
          artefactId: 'dataflow.test.derive', nextStepId: 'evaluate',
        },
      },
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'FLOW_CYCLE_UNSUPPORTED')).toBe(true);
  });
});

// ── validateFlow — EFFECT.onErrorStepId required ──────────────────────────────

describe('validateFlow — EFFECT.onErrorStepId required', () => {
  const effectBase = {
    ...base,
    entryStepId: 'call_abs',
    steps: {
      ...base.steps,
      call_abs: {
        id: 'call_abs', type: 'EFFECT', subtype: 'CALL',
        title: 'Вызов АБС', description: 'Отправляет запрос в АБС.',
        operationId: 'abs.findClient',
        inputRef: '$.input.application',
        nextStepId: 'evaluate',
        onErrorStepId: 'finish_fail',
      },
    },
  };

  it('accepts EFFECT with onErrorStepId', () => {
    const r = validateFlow(effectBase);
    expect(r.ok).toBe(true);
  });

  it('rejects EFFECT without onErrorStepId', () => {
    const { onErrorStepId, ...noErr } = effectBase.steps.call_abs as any;
    const r = validateFlow({ ...effectBase, steps: { ...effectBase.steps, call_abs: noErr } });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'FLOW_EFFECT_ON_ERROR_MISSING')).toBe(true);
  });
});

// ── validateFlow — WAIT.sourceStepId must reference EFFECT ───────────────────

describe('validateFlow — WAIT.sourceStepId must reference EFFECT', () => {
  const withEffectAndWait = {
    ...base,
    entryStepId: 'call_abs',
    steps: {
      ...base.steps,
      call_abs: {
        id: 'call_abs', type: 'EFFECT', subtype: 'COMMAND',
        title: 'Вызов АБС', description: 'Запрос в АБС.',
        operationId: 'abs.findClient',
        inputRef: '$.input.application',
        nextStepId: 'wait_abs',
        onErrorStepId: 'finish_fail',
      },
      wait_abs: {
        id: 'wait_abs', type: 'WAIT', subtype: 'MESSAGE',
        title: 'Ожидать ответа', description: 'Ожидает ответ от АБС.',
        sourceStepId: 'call_abs',
        nextStepId: 'evaluate',
        onErrorStepId: 'finish_fail',
        onTimeoutStepId: 'finish_fail',
      },
    },
  };

  it('accepts WAIT with sourceStepId referencing EFFECT', () => {
    expect(validateFlow(withEffectAndWait).ok).toBe(true);
  });

  it('rejects WAIT with sourceStepId referencing non-EFFECT step', () => {
    const r = validateFlow({ ...withEffectAndWait, steps: { ...withEffectAndWait.steps, wait_abs: { ...withEffectAndWait.steps.wait_abs, sourceStepId: 'evaluate' } } });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'FLOW_WAIT_SOURCE_NOT_EFFECT')).toBe(true);
  });

  it('rejects WAIT with sourceStepId referencing itself', () => {
    const r = validateFlow({ ...withEffectAndWait, steps: { ...withEffectAndWait.steps, wait_abs: { ...withEffectAndWait.steps.wait_abs, sourceStepId: 'wait_abs' } } });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'FLOW_WAIT_SOURCE_NOT_EFFECT')).toBe(true);
  });

  it('rejects WAIT whose source EFFECT does not transition to this WAIT', () => {
    const r = validateFlow({
      ...withEffectAndWait,
      steps: {
        ...withEffectAndWait.steps,
        call_abs: { ...withEffectAndWait.steps.call_abs, nextStepId: 'evaluate' },
      },
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'FLOW_WAIT_SOURCE_TRANSITION_MISMATCH')).toBe(true);
  });

  it('rejects CALL -> WAIT because CALL is synchronous', () => {
    const r = validateFlow({
      ...withEffectAndWait,
      steps: {
        ...withEffectAndWait.steps,
        call_abs: { ...withEffectAndWait.steps.call_abs, subtype: 'CALL' },
      },
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'FLOW_CALL_WAIT_UNSUPPORTED')).toBe(true);
  });
});

// ── validateFlow — metadata ───────────────────────────────────────────────────

describe('validateFlow — metadata validation', () => {
  it('accepts valid metadata object', () => {
    const r = validateFlow({ ...base, metadata: { env: 'test', priority: 1 } });
    expect(r.ok).toBe(true);
  });

  it('rejects metadata as scalar string', () => {
    const r = validateFlow({ ...base, metadata: 'x' as any });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'FLOW_METADATA_INVALID')).toBe(true);
  });
});

// ── JSON Schema parity ───────────────────────────────────────────────────────

describe('JSON Schema parity with validateFlow', () => {
  async function schemaAccepts(flow: unknown): Promise<boolean> {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { default: Ajv2020 } = await import('ajv/dist/2020.js');
    const schema = JSON.parse(readFileSync(join('dist', 'schema', 'flow.schema.json'), 'utf8'));
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    return Boolean(ajv.compile(schema)(flow));
  }

  it('schema and validateFlow both accept the canonical fixture', async () => {
    expect(await schemaAccepts(base)).toBe(true);
    expect(validateFlow(base).ok).toBe(true);
  });

  it('schema and validateFlow both reject COMMAND with SUBFLOW-only fields', async () => {
    const flow = {
      ...base,
      steps: {
        ...base.steps,
        command: {
          id: 'command', type: 'EFFECT', subtype: 'COMMAND',
          title: 'Command', description: 'Command.',
          operationId: 'op', inputRef: '$.input',
          nextStepId: 'finish_ok', onErrorStepId: 'finish_fail',
          flowId: 'wrong', flowVersion: '1.0.0',
        },
      },
    };
    expect(await schemaAccepts(flow)).toBe(false);
    expect(validateFlow(flow).ok).toBe(false);
    expect(validateFlow(flow).issues.some(i => i.code === 'FLOW_STEP_FORBIDDEN_FIELD')).toBe(true);
  });

  it('schema and validateFlow both reject terminal result mixed with resultRef', async () => {
    const flow = {
      ...base,
      steps: {
        ...base.steps,
        finish_ok: {
          ...base.steps.finish_ok,
          result: { status: 'COMPLETE', outcome: 'OK' },
        },
      },
    };
    expect(await schemaAccepts(flow)).toBe(false);
    expect(validateFlow(flow).ok).toBe(false);
    expect(validateFlow(flow).issues.some(i => i.code === 'FLOW_TERMINAL_RESULT_AMBIGUOUS')).toBe(true);
  });

  it('schema and validateFlow both reject old context refs', async () => {
    const flow = {
      ...base,
      steps: {
        ...base.steps,
        route: {
          ...base.steps.route,
          ref: '$.context.data.decisions.validation.outcome',
        },
      },
    };
    expect(await schemaAccepts(flow)).toBe(false);
    expect(validateFlow(flow).ok).toBe(false);
    expect(validateFlow(flow).issues.some(i => i.code === 'FLOW_ROUTE_REF_INVALID')).toBe(true);
  });
});

// ── createProcessState ────────────────────────────────────────────────────────

describe('createProcessState', () => {
  it('creates State v2 with root input/data/steps/timeline — no old context/history', () => {
    const flow = prepareFlow(base);
    const state = createProcessState({ flow, processId: 'p-001', input: { application: { x: 1 } } });
    expect(state.stateVersion).toBe('flow5-state-v2');
    expect(state.data).toBeDefined();
    expect(state.data.facts).toEqual({});
    expect(state.data.decisions).toEqual({});
    expect(state.data.checks).toEqual({});
    expect(state.data.payloads).toEqual({});
    expect(state.data.results).toEqual({});
    expect(state.input).toEqual({ application: { x: 1 } });
    expect(state.steps).toEqual({});
    expect(state.timeline).toEqual([]);
    expect((state as any).context).toBeUndefined();
    expect((state as any).history).toBeUndefined();
    expect(state.flowId).toBe('flow.test');
    expect(state.flowVersion).toBe('1.0.0');
  });
});

// ── plan(PROCESS/DATA) ────────────────────────────────────────────────────────

describe('plan(PROCESS/DATA)', () => {
  it('returns artefactId and nextStepId — no input, no contract', () => {
    const flow = prepareFlow(base);
    const state = createProcessState({ flow, processId: 'p-002' });
    const step = plan(flow, state);
    expect(step.type).toBe('PROCESS');
    expect(step.subtype).toBe('DATA');
    expect((step as any).artefactId).toBe('dataflow.test.evaluate');
    expect((step as any).nextStepId).toBe('route');
    expect((step as any).input).toBeUndefined();
    expect((step as any).contract).toBeUndefined();
    expect((step as any).outputRef).toBeUndefined();
  });
});

// ── reduce(PROCESS/DATA) ──────────────────────────────────────────────────────

describe('reduce(PROCESS/DATA)', () => {
  it('applies DataflowOutput.writes to $.data.* atomically', () => {
    const flow = prepareFlow(base);
    const state = createProcessState({ flow, processId: 'p-003' });
    const step = plan(flow, state);

    const next = reduce(step as any, state, {
      writes: [
        { ref: '$.data.facts.validation', value: { errorCount: 0 }, itemId: 'derive_facts' },
        { ref: '$.data.decisions.validation', value: { outcome: 'CONTINUE', decisionSetId: 'x' }, itemId: 'decide' },
      ],
    });

    expect((next.data.facts as any).validation.errorCount).toBe(0);
    expect((next.data.decisions as any).validation.outcome).toBe('CONTINUE');
    expect(next.current.stepId).toBe('route');
  });

  it('rejects writes outside $.data.*', () => {
    const flow = prepareFlow(base);
    const state = createProcessState({ flow, processId: 'p-004' });
    const step = plan(flow, state);
    expect(() => reduce(step as any, state, { writes: [{ ref: '$.input.x', value: 1, itemId: 'bad' }] })).toThrow();
  });

  it('rejects non-array writes', () => {
    const flow = prepareFlow(base);
    const state = createProcessState({ flow, processId: 'p-005' });
    const step = plan(flow, state);
    expect(() => reduce(step as any, state, { writes: 'not-array' })).toThrow();
  });

  it('rejects write with non-json-safe value', () => {
    const flow = prepareFlow(base);
    const state = createProcessState({ flow, processId: 'p-006' });
    const step = plan(flow, state);
    expect(() => reduce(step as any, state, { writes: [{ ref: '$.data.facts.x', value: () => {}, itemId: 'fn' }] })).toThrow();
  });
});

// ── CONTROL/ROUTE runtime ─────────────────────────────────────────────────────

describe('CONTROL/ROUTE', () => {
  function stateAtRoute(decisionOutcome: string | undefined) {
    const flow = prepareFlow(base);
    const state = createProcessState({ flow, processId: 'p-route' });
    const dataStep = plan(flow, state);
    const writes = decisionOutcome !== undefined
      ? [
          { ref: '$.data.decisions.validation', value: { outcome: decisionOutcome }, itemId: 'decide' },
          // finish_ok uses resultRef — must be present in state before route transitions to it
          { ref: '$.data.results.success', value: { status: 'COMPLETE', outcome: 'ACCEPTED' }, itemId: 'build_result' },
        ]
      : [];
    return { flow, state: reduce(dataStep as any, state, { writes }) };
  }

  it('routes to matched case', () => {
    const { flow, state } = stateAtRoute('CONTINUE');
    const routeStep = plan(flow, state);
    expect(routeStep.type).toBe('CONTROL');
    expect((routeStep as any).selectedNextStepId).toBe('finish_ok');
  });

  it('routes to defaultNextStepId on no match', () => {
    const { flow, state } = stateAtRoute('UNKNOWN');
    const routeStep = plan(flow, state);
    expect((routeStep as any).selectedNextStepId).toBe('finish_fail');
  });

  it('throws FLOW_ROUTE_REF_NOT_RESOLVED on missing ref — not silently using default', () => {
    // ref points to decisions.validation.outcome, but we wrote nothing to decisions
    const { flow, state } = stateAtRoute(undefined);
    // ref $.data.decisions.validation.outcome will not be found
    expect(() => plan(flow, state)).toThrow();
    try {
      plan(flow, state);
    } catch (e: any) {
      expect(e.code).toBe('FLOW_ROUTE_REF_NOT_RESOLVED');
    }
  });

  it('reduce(ROUTE) advances to selectedNextStepId', () => {
    const { flow, state } = stateAtRoute('CONTINUE');
    const routeStep = plan(flow, state);
    const afterRoute = reduce(routeStep as any, state, null);
    expect(afterRoute.current.stepId).toBe('finish_ok');
  });
});

// ── TERMINAL ──────────────────────────────────────────────────────────────────

describe('TERMINAL', () => {
  function runToTerminal(outcome: 'CONTINUE' | 'REJECT') {
    const flow = prepareFlow(base);
    let state = createProcessState({ flow, processId: 'p-term' });
    const dataStep = plan(flow, state);
    state = reduce(dataStep as any, state, {
      writes: [
        { ref: '$.data.decisions.validation', value: { outcome }, itemId: 'decide' },
        { ref: '$.data.results.success', value: { status: 'COMPLETE', outcome: 'ACCEPTED' }, itemId: 'build_result' },
      ],
    });
    const routeStep = plan(flow, state);
    state = reduce(routeStep as any, state, null);
    return { flow, state };
  }

  it('TERMINAL/COMPLETE via resultRef reads from $.data.results.*', () => {
    const { state } = runToTerminal('CONTINUE');
    // followTransition transitions to COMPLETE immediately
    expect(state.status).toBe('COMPLETE');
    expect(state.result?.outcome).toBe('ACCEPTED');
  });

  it('TERMINAL/FAIL via static result', () => {
    const { state } = runToTerminal('REJECT');
    expect(state.status).toBe('FAIL');
    expect(state.result?.outcome).toBe('REJECTED');
  });

  it('reduce(TERMINAL) on already-finalized state returns state as-is (idempotent)', () => {
    const { state } = runToTerminal('CONTINUE');
    // State is COMPLETE — reduce(TERMINAL) is idempotent on finalized state
    const termStep = { id: state.current.stepId, type: 'TERMINAL', subtype: state.current.subtype };
    const result = reduce(termStep as any, state, null);
    expect(result.status).toBe('COMPLETE');
  });
});


// ── Public API boundary (no raw TypeErrors) ──────────────────────────────────

describe('public API boundary — typed errors, no raw TypeErrors', () => {
  it('createProcessState(null) throws XRuntimeError', () => {
    expect(() => (createProcessState as any)(null)).toThrow();
    try { (createProcessState as any)(null); } catch (e: any) { expect(e.code).toBe('FLOW_RUNTIME_INPUT_INVALID'); }
  });

  it('plan(null, state) throws XRuntimeError', () => {
    const flow = prepareFlow(base);
    const state = createProcessState({ flow, processId: 'b-001' });
    expect(() => (plan as any)(null, state)).toThrow();
    try { (plan as any)(null, state); } catch (e: any) { expect(e.code).toBe('FLOW_RUNTIME_INPUT_INVALID'); }
  });

  it('plan(flow, null) throws XRuntimeError', () => {
    const flow = prepareFlow(base);
    expect(() => (plan as any)(flow, null)).toThrow();
    try { (plan as any)(flow, null); } catch (e: any) { expect(e.code).toBe('FLOW_RUNTIME_INPUT_INVALID'); }
  });

  it('reduce(null, state, output) throws XRuntimeError', () => {
    const flow = prepareFlow(base);
    const state = createProcessState({ flow, processId: 'b-002' });
    expect(() => (reduce as any)(null, state, { writes: [] })).toThrow();
    try { (reduce as any)(null, state, { writes: [] }); } catch (e: any) { expect(e.code).toBe('FLOW_RUNTIME_INPUT_INVALID'); }
  });

  it('reduce(step, null, output) throws XRuntimeError', () => {
    const flow = prepareFlow(base);
    const state = createProcessState({ flow, processId: 'b-003' });
    const step = plan(flow, state);
    expect(() => (reduce as any)(step, null, { writes: [] })).toThrow();
    try { (reduce as any)(step, null, { writes: [] }); } catch (e: any) { expect(e.code).toBe('FLOW_RUNTIME_INPUT_INVALID'); }
  });

  it('reduce with non-JSON-safe trace throws FLOW_DATA_OUTPUT_INVALID', () => {
    const flow = prepareFlow(base);
    const state = createProcessState({ flow, processId: 'b-004' });
    const step = plan(flow, state);
    expect(() => reduce(step as any, state, { writes: [], trace: [() => {}] as any })).toThrow();
    try {
      reduce(step as any, state, { writes: [], trace: [() => {}] as any });
    } catch (e: any) {
      expect(e.code).toBe('FLOW_DATA_OUTPUT_INVALID');
    }
  });
});



// ── TERMINAL reduce finalization on ACTIVE terminal state ───────────────────

describe('reduce(TERMINAL)', () => {
  it('finalizes ACTIVE terminal state with static result', () => {
    const terminalFlow = prepareFlow({
      id: 'flow.terminal.static',
      version: '1.0.0',
      title: 'Terminal flow',
      description: 'Starts directly at a terminal step for runtime finalization testing.',
      entryStepId: 'finish',
      steps: {
        finish: {
          id: 'finish', type: 'TERMINAL', subtype: 'COMPLETE',
          title: 'Finish', description: 'Completes.',
          result: { status: 'COMPLETE', outcome: 'DONE' },
        },
      },
    });
    const state = createProcessState({ flow: terminalFlow, processId: 'terminal-static' });
    const active = { ...state, status: 'ACTIVE' as const, result: null };
    const step = { id: 'finish', type: 'TERMINAL', subtype: 'COMPLETE', result: { status: 'COMPLETE', outcome: 'DONE' } };
    const next = reduce(step as any, active, null);
    expect(next.status).toBe('COMPLETE');
    expect(next.result?.outcome).toBe('DONE');
  });
});

// ── EFFECT / WAIT public API boundary ───────────────────────────────────────

describe('apply/resume public API boundary', () => {
  const effectFlowDef = {
    id: 'flow.effect.boundary',
    version: '1.0.0',
    title: 'Effect boundary flow',
    description: 'Tests EFFECT and WAIT runtime boundary.',
    entryStepId: 'call_abs',
    steps: {
      call_abs: {
        id: 'call_abs', type: 'EFFECT', subtype: 'COMMAND',
        title: 'Call ABS', description: 'Calls ABS.',
        operationId: 'abs.call', inputRef: '$.input.payload',
        nextStepId: 'wait_abs', onErrorStepId: 'finish_fail',
      },
      wait_abs: {
        id: 'wait_abs', type: 'WAIT', subtype: 'MESSAGE',
        title: 'Wait ABS', description: 'Waits ABS.',
        sourceStepId: 'call_abs', nextStepId: 'finish_ok',
        onErrorStepId: 'finish_fail', onTimeoutStepId: 'finish_fail',
      },
      finish_ok: {
        id: 'finish_ok', type: 'TERMINAL', subtype: 'COMPLETE',
        title: 'OK', description: 'Done.', result: { status: 'COMPLETE', outcome: 'OK' },
      },
      finish_fail: {
        id: 'finish_fail', type: 'TERMINAL', subtype: 'FAIL',
        title: 'Fail', description: 'Failed.', result: { status: 'FAIL', outcome: 'FAIL' },
      },
    },
  } as const;

  it('apply(null state) throws typed FLOW_RUNTIME_INPUT_INVALID', () => {
    const flow = prepareFlow(effectFlowDef);
    try { (apply as any)(flow, null, 'call_abs', {}); throw new Error('expected error'); }
    catch (e: any) { expect(e).toBeInstanceOf(XRuntimeError); expect(e.code).toBe('FLOW_RUNTIME_INPUT_INVALID'); }
  });

  it('resume(null state) throws typed FLOW_RUNTIME_INPUT_INVALID', () => {
    const flow = prepareFlow(effectFlowDef);
    try { (resume as any)(flow, null, 'wait_abs', {}); throw new Error('expected error'); }
    catch (e: any) { expect(e).toBeInstanceOf(XRuntimeError); expect(e.code).toBe('FLOW_RUNTIME_INPUT_INVALID'); }
  });

  it('apply(null flow) reports flow boundary, not state mismatch', () => {
    const flow = prepareFlow(effectFlowDef);
    const state = createProcessState({ flow, processId: 'apply-flow', input: { payload: {} } });
    try { (apply as any)(null, state, 'call_abs', {}); throw new Error('expected error'); }
    catch (e: any) { expect(e.code).toBe('FLOW_RUNTIME_INPUT_INVALID'); }
  });

  it('apply malformed effectResult throws typed runtime input error', () => {
    const flow = prepareFlow(effectFlowDef);
    const state = createProcessState({ flow, processId: 'apply-result', input: { payload: {} } });
    try { (apply as any)(flow, state, 'call_abs', null); throw new Error('expected error'); }
    catch (e: any) { expect(e.code).toBe('FLOW_RUNTIME_INPUT_INVALID'); }
  });

  it('COMMAND → WAIT → resume success stores command result and completes WAIT execution', () => {
    const flow = prepareFlow(effectFlowDef);
    let state = createProcessState({ flow, processId: 'command-success', input: { payload: {} }, trace: 'off' });

    state = apply(flow, state, 'call_abs', { requestId: 'req-1', result: { accepted: true } });
    expect(state.status).toBe('WAITING');
    expect(state.steps.call_abs.title).toBe('Call ABS');
    expect(state.steps.call_abs.description).toBe('Calls ABS.');
    expect(state.steps.wait_abs.title).toBe('Wait ABS');
    expect(state.steps.wait_abs.description).toBe('Waits ABS.');
    expect(state.steps.call_abs.executions[0].command?.status).toBe('WAITING');
    expect(state.steps.wait_abs.executions[0].wait?.requestId).toBe('req-1');

    state = resume(flow, state, 'wait_abs', { requestId: 'req-1', result: { status: 'SUCCESS', payload: { ok: true } } });
    expect(state.status).toBe('COMPLETE');
    expect(state.steps.finish_ok.title).toBe('OK');
    expect(state.steps.finish_ok.description).toBe('Done.');
    expect(state.steps.call_abs.executions[0].command?.status).toBe('COMPLETED');
    expect(state.steps.call_abs.executions[0].command?.result).toEqual({ status: 'SUCCESS', payload: { ok: true } });
    expect(state.steps.wait_abs.executions[0].wait?.outcome).toBe('SUCCESS');
    expect(state.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ stepId: 'call_abs', kind: 'STEP_WAITING', status: 'WAITING' }),
      expect.objectContaining({ stepId: 'call_abs', kind: 'STEP_COMPLETED', status: 'COMPLETED' }),
      expect.objectContaining({ stepId: 'wait_abs', kind: 'STEP_RESUMED', status: 'COMPLETED' }),
    ]));
  });

  it('resume rejects requestId mismatch for COMMAND', () => {
    const flow = prepareFlow(effectFlowDef);
    let state = createProcessState({ flow, processId: 'command-mismatch', input: { payload: {} } });
    state = apply(flow, state, 'call_abs', { requestId: 'req-1', result: { accepted: true } });

    try {
      resume(flow, state, 'wait_abs', { requestId: 'req-2', result: { status: 'SUCCESS' } });
      throw new Error('expected error');
    } catch (e: any) {
      expect(e.code).toBe('FLOW_RESUME_REQUEST_ID_MISMATCH');
    }
  });

  it('resume timeout routes to onTimeoutStepId', () => {
    const flow = prepareFlow(effectFlowDef);
    let state = createProcessState({ flow, processId: 'command-timeout', input: { payload: {} } });
    state = apply(flow, state, 'call_abs', { requestId: 'req-timeout', result: { accepted: true } });
    state = resume(flow, state, 'wait_abs', { requestId: 'req-timeout', error: { type: 'TIMEOUT' }, errorCode: 'TIMEOUT' });
    expect(state.status).toBe('FAIL');
    expect(state.current.stepId).toBe('finish_fail');
    expect(state.steps.wait_abs.executions[0].wait?.outcome).toBe('TIMEOUT');
    expect(state.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ stepId: 'call_abs', kind: 'STEP_FAILED', status: 'FAILED' }),
      expect.objectContaining({ stepId: 'wait_abs', kind: 'STEP_RESUMED', status: 'FAILED' }),
    ]));
  });

  it('resume timeout without error payload routes to onTimeoutStepId', () => {
    const flow = prepareFlow(effectFlowDef);
    let state = createProcessState({ flow, processId: 'command-timeout-code-only', input: { payload: {} } });
    state = apply(flow, state, 'call_abs', { requestId: 'req-timeout-code-only', result: { accepted: true } });
    state = resume(flow, state, 'wait_abs', { requestId: 'req-timeout-code-only', errorCode: 'TIMEOUT' });
    expect(state.status).toBe('FAIL');
    expect(state.current.stepId).toBe('finish_fail');
    expect(state.steps.call_abs.executions[0].status).toBe('FAILED');
    expect(state.steps.call_abs.executions[0].failureCode).toBe('TIMEOUT');
    expect(state.steps.wait_abs.executions[0].status).toBe('FAILED');
    expect(state.steps.wait_abs.executions[0].wait?.outcome).toBe('TIMEOUT');
  });

  it('resume error routes to onErrorStepId', () => {
    const flow = prepareFlow(effectFlowDef);
    let state = createProcessState({ flow, processId: 'command-error', input: { payload: {} } });
    state = apply(flow, state, 'call_abs', { requestId: 'req-error', result: { accepted: true } });
    state = resume(flow, state, 'wait_abs', { requestId: 'req-error', error: { type: 'ERROR' }, errorCode: 'ERROR' });
    expect(state.status).toBe('FAIL');
    expect(state.current.stepId).toBe('finish_fail');
    expect(state.steps.wait_abs.executions[0].wait?.outcome).toBe('ERROR');
  });

  it('SUBFLOW → WAIT → resume success stores subflow result and checks requestId correlation', () => {
    const subflowDef = {
      ...effectFlowDef,
      id: 'flow.effect.subflow',
      steps: {
        ...effectFlowDef.steps,
        call_abs: {
          ...effectFlowDef.steps.call_abs,
          subtype: 'SUBFLOW',
          flowId: 'child.flow',
          flowVersion: '1.0.0',
          operationId: 'child.run',
        },
      },
    } as const;
    const flow = prepareFlow(subflowDef);
    let state = createProcessState({ flow, processId: 'subflow-success', input: { payload: {} } });
    state = apply(flow, state, 'call_abs', { requestId: 'child-1', result: { childProcessId: 'child-1' } });
    state = resume(flow, state, 'wait_abs', { requestId: 'child-1', result: { status: 'COMPLETE', outcome: 'DONE' } });

    expect(state.status).toBe('COMPLETE');
    expect(state.steps.call_abs.executions[0].subflow?.status).toBe('COMPLETED');
    expect(state.steps.call_abs.executions[0].subflow?.result).toEqual({ status: 'COMPLETE', outcome: 'DONE' });
  });

  it('resume rejects requestId mismatch for SUBFLOW completion', () => {
    const subflowDef = {
      ...effectFlowDef,
      id: 'flow.effect.subflow.mismatch',
      steps: {
        ...effectFlowDef.steps,
        call_abs: {
          ...effectFlowDef.steps.call_abs,
          subtype: 'SUBFLOW',
          flowId: 'child.flow',
          flowVersion: '1.0.0',
          operationId: 'child.run',
        },
      },
    } as const;
    const flow = prepareFlow(subflowDef);
    let state = createProcessState({ flow, processId: 'subflow-mismatch', input: { payload: {} } });
    state = apply(flow, state, 'call_abs', { requestId: 'child-1', result: { childProcessId: 'child-1' } });

    try {
      resume(flow, state, 'wait_abs', { requestId: 'child-2', result: { status: 'COMPLETE', outcome: 'DONE' } });
      throw new Error('expected error');
    } catch (e: any) {
      expect(e.code).toBe('FLOW_RESUME_REQUEST_ID_MISMATCH');
    }
  });

  it('rejects legacy State v1 context/history/effects/waitResult shape at runtime boundary', () => {
    const flow = prepareFlow(effectFlowDef);
    const state = createProcessState({ flow, processId: 'legacy-state', input: { payload: {} } });
    const legacy = {
      ...state,
      context: { input: {}, effects: { call_abs: { waitResult: {} } } },
      history: [],
    };
    try {
      plan(flow, legacy as any);
      throw new Error('expected error');
    } catch (e: any) {
      expect(['FLOW_CONTEXT_FORBIDDEN', 'FLOW_CONTEXT_EFFECTS_FORBIDDEN', 'FLOW_WAIT_RESULT_PERSISTED_FORBIDDEN', 'FLOW_STATE_V1_FORBIDDEN']).toContain(e.code);
    }
  });

  it('allows domain fields named waitResult inside input and data zones', () => {
    const flow = prepareFlow(effectFlowDef);
    const state = createProcessState({
      flow,
      processId: 'domain-wait-result',
      input: { application: { waitResult: 'merchant-field' }, payload: {} },
    });
    state.data.facts = { waitResult: 'domain-fact' };
    expect(plan(flow, state).type).toBe('EFFECT');
  });

  it('rejects persisted runtime waitResult projections in step executions', () => {
    const flow = prepareFlow(effectFlowDef);
    let state = createProcessState({ flow, processId: 'runtime-wait-result', input: { payload: {} } });
    state = apply(flow, state, 'call_abs', { requestId: 'req-runtime-wait-result', result: { accepted: true } });
    const corrupted = structuredClone(state) as any;
    corrupted.steps.call_abs.executions[0].command.waitResult = { legacy: true };

    try {
      resume(flow, corrupted, 'wait_abs', { requestId: 'req-runtime-wait-result', result: { ok: true } });
      throw new Error('expected error');
    } catch (e: any) {
      expect(e.code).toBe('FLOW_WAIT_RESULT_PERSISTED_FORBIDDEN');
    }
  });

  it('all examples validate as Flow5', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const name of readdirSync('examples').filter((x) => x.endsWith('.json'))) {
      const example = JSON.parse(readFileSync(join('examples', name), 'utf8'));
      const result = validateFlow(example);
      expect(result.ok, `${name}: ${JSON.stringify(result.issues)}`).toBe(true);
    }
  });

  it('all examples validate against exported Flow5 JSON Schema', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { default: Ajv2020 } = await import('ajv/dist/2020.js');
    const schema = JSON.parse(readFileSync(join('dist', 'schema', 'flow.schema.json'), 'utf8'));
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    for (const name of readdirSync('examples').filter((x) => x.endsWith('.json'))) {
      const example = JSON.parse(readFileSync(join('examples', name), 'utf8'));
      const ok = validate(example);
      expect(ok, `${name}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });
});

// ── Full end-to-end cycle ─────────────────────────────────────────────────────

describe('end-to-end: DATA → ROUTE → TERMINAL', () => {
  it('completes correctly with dataflow writes driving the flow', () => {
    const flow = prepareFlow(base);
    let state = createProcessState({ flow, processId: 'e2e-001', input: { clientId: 'APP-001' } });

    expect(state.status).toBe('ACTIVE');
    expect(state.current.stepId).toBe('evaluate');

    const dataStep = plan(flow, state);
    expect(dataStep.type).toBe('PROCESS');
    expect((dataStep as any).artefactId).toBe('dataflow.test.evaluate');

    state = reduce(dataStep as any, state, {
      writes: [
        { ref: '$.data.facts.validation', value: { errorCount: 0 }, itemId: 'facts' },
        { ref: '$.data.decisions.validation', value: { outcome: 'CONTINUE', decisionSetId: 'x' }, itemId: 'decide' },
        { ref: '$.data.results.success', value: { status: 'COMPLETE', outcome: 'ACCEPTED' }, itemId: 'result' },
      ],
    });
    expect(state.current.stepId).toBe('route');
    expect(state.steps.evaluate.title).toBe('Оценить данные');
    expect(state.steps.evaluate.description).toBe('Запускает dataflow для принятия решения.');

    const routeStep = plan(flow, state);
    expect((routeStep as any).selectedNextStepId).toBe('finish_ok');
    state = reduce(routeStep as any, state, null);
    expect(state.current.stepId).toBe('finish_ok');
    expect(state.status).toBe('COMPLETE');
    expect(state.result?.outcome).toBe('ACCEPTED');
    expect(state.steps.route.title).toBe('Маршрутизировать');
    expect(state.steps.route.description).toBe('Выбирает ветку по исходу dataflow.');
    expect(state.steps.finish_ok.title).toBe('Завершить успешно');
    expect(state.steps.finish_ok.description).toBe('Фиксирует успешный результат.');
  });
});
