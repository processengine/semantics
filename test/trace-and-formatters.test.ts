import { describe, expect, it } from 'vitest';
import {
  createProcessState,
  createFlowTrace,
  formatFlowTrace,
  formatRuntimeError,
  formatValidationIssues,
  plan,
  prepareFlow,
  reduce,
  XRuntimeError,
  type FlowDefinition,
} from '../src/index.js';

const traceFlow: FlowDefinition = {
  id: 'trace.flow',
  version: '2026-04-09',
  entryStepId: 'map_input',
  steps: {
    map_input: {
      id: 'map_input',
      type: 'PROCESS',
      subtype: 'MAPPINGS',
      artefactId: 'process.map',
      contract: { input: { ref: '$.context.input' }, output: { ref: '$.context.facts.mapped' } },
      nextStepId: 'finish_complete',
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
  },
};

describe('trace and formatter contract', () => {
  it('produces basic trace entries from canonical history', () => {
    const flow = prepareFlow(traceFlow);
    const state = createProcessState({
      flow,
      processId: 'proc-trace-basic',
      trace: 'basic',
      input: { requestId: 'REQ-1' },
    });

    const step = plan(flow, state);
    if (step.type !== 'PROCESS' || step.subtype !== 'MAPPINGS') throw new Error('unexpected step');
    const nextState = reduce(step, state, { code: 'mapped' });
    const trace = createFlowTrace(nextState);

    expect(trace).toHaveLength(2);
    expect(trace[0]).toMatchObject({
      mode: 'basic',
      stepId: 'map_input',
      kind: 'STEP_COMPLETED',
    });
    expect(trace[1]).toMatchObject({
      mode: 'basic',
      stepId: 'finish_complete',
      kind: 'STEP_COMPLETED',
    });
  });

  it('produces verbose trace with runtime details', () => {
    const flow = prepareFlow(traceFlow);
    const state = createProcessState({
      flow,
      processId: 'proc-trace-verbose',
      trace: 'verbose',
      input: { requestId: 'REQ-2' },
    });

    const step = plan(flow, state);
    if (step.type !== 'PROCESS' || step.subtype !== 'MAPPINGS') throw new Error('unexpected step');
    const nextState = reduce(step, state, { code: 'mapped' });
    const trace = createFlowTrace(nextState, 'verbose');

    expect(trace).toHaveLength(2);
    if (trace[0]?.mode !== 'verbose') throw new Error('unexpected trace mode');
    expect(trace[0].runtime).toBeTruthy();
    expect(formatFlowTrace(trace)).toContain('[verbose]');
  });

  it('formats validation issues and runtime errors as public strings', () => {
    const issuesText = formatValidationIssues([
      {
        code: 'FLOW_INVALID_TYPE',
        message: 'Unsupported step type',
        path: '$.steps["x"].type',
      },
    ]);

    expect(issuesText).toContain('FLOW_INVALID_TYPE');
    expect(issuesText).toContain('$.steps["x"].type');

    const runtimeText = formatRuntimeError(
      new XRuntimeError('FLOW_STATE_INVALID', 'broken state', { processId: 'proc-1' }),
    );
    expect(runtimeText).toContain('FLOW_STATE_INVALID');
    expect(runtimeText).toContain('processId');
  });
});
