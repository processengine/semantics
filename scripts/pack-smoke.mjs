import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const workdir = mkdtempSync(join(tmpdir(), 'semantics-smoke-'));

execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
const tarball = execFileSync('npm', ['pack'], { cwd: root, encoding: 'utf8' }).trim().split('\n').pop();

writeFileSync(join(workdir, 'package.json'), JSON.stringify({ name: 'smoke', private: true, type: 'module' }));
execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', join(root, tarball)], { cwd: workdir, stdio: 'inherit' });

// The public schema exported by the packed package must validate every official Flow 5 example.
// This protects the package contract: docs/examples/runtime/schema must describe the same DSL.
const installedRoot = join(workdir, 'node_modules', '@processengine', 'semantics');
const schema = JSON.parse(readFileSync(join(installedRoot, 'dist', 'schema', 'flow.schema.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateSchema = ajv.compile(schema);
for (const name of readdirSync(join(installedRoot, 'examples')).filter((x) => x.endsWith('.json'))) {
  const example = JSON.parse(readFileSync(join(installedRoot, 'examples', name), 'utf8'));
  if (!validateSchema(example)) {
    throw new Error('packaged example does not validate against exported schema: ' + name + ' ' + JSON.stringify(validateSchema.errors));
  }
}

const script = `
import { validateFlow, prepareFlow, createProcessState, plan, reduce, XCompileError, XRuntimeError } from '@processengine/semantics';

// ── Smoke 1: valid Flow 5 flow ────────────────────────────────────────────────
const flowDef = {
  id: 'flow.smoke', version: '1.0.0',
  title: 'Smoke', description: 'Smoke test.',
  entryStepId: 'evaluate',
  steps: {
    evaluate: { id: 'evaluate', type: 'PROCESS', subtype: 'DATA', title: 'Evaluate', description: 'Runs dataflow.', artefactId: 'dataflow.smoke', nextStepId: 'finish' },
    finish: { id: 'finish', type: 'TERMINAL', subtype: 'COMPLETE', title: 'Finish', description: 'Done.', result: { status: 'COMPLETE', outcome: 'DONE' } },
  },
};

const v = validateFlow(flowDef);
if (!v.ok) throw new Error('validate failed: ' + JSON.stringify(v.issues));

const flow = prepareFlow(flowDef);
const state = createProcessState({ flow, processId: 'smoke-001' });

// ── Smoke 2: context.data.* structure ────────────────────────────────────────
if (!state.context.data?.facts) throw new Error('context.data.facts missing');
if (state.context.facts !== undefined) throw new Error('old context.facts must not exist');
if (state.flowId !== 'flow.smoke') throw new Error('flowId wrong: ' + state.flowId);

// ── Smoke 3: plan(DATA) — artefactId, no input ───────────────────────────────
const dataStep = plan(flow, state);
if (dataStep.type !== 'PROCESS' || dataStep.subtype !== 'DATA') throw new Error('wrong DATA step');
if (dataStep.input !== undefined) throw new Error('DATA step must not expose input');
if (dataStep.artefactId !== 'dataflow.smoke') throw new Error('wrong artefactId');

// ── Smoke 4: reduce(DATA) applies writes ─────────────────────────────────────
const nextState = reduce(dataStep, state, {
  writes: [{ ref: '$.context.data.decisions.x', value: { outcome: 'DONE' }, itemId: 'i1' }],
});
if (nextState.currentStepId !== 'finish') throw new Error('wrong next step: ' + nextState.currentStepId);
if (!nextState.context.data.decisions.x) throw new Error('write not applied');
if (nextState.status !== 'COMPLETE') throw new Error('TERMINAL not reached: ' + nextState.status);

// ── Smoke 5: reduce(DATA) rejects writes outside $.context.data.* ────────────
let threw = false;
try { reduce(dataStep, state, { writes: [{ ref: '$.context.facts.x', value: 1, itemId: 'bad' }] }); }
catch { threw = true; }
if (!threw) throw new Error('forbidden write should throw');

// ── Smoke 6: ROUTE missing ref → error (not default) ─────────────────────────
const routeFlow = prepareFlow({
  ...flowDef,
  steps: {
    ...flowDef.steps,
    evaluate: { ...flowDef.steps.evaluate, nextStepId: 'route' },
    route: { id: 'route', type: 'CONTROL', subtype: 'ROUTE', title: 'Route', description: 'Routes.', ref: '$.context.data.decisions.y.outcome', cases: { A: 'finish' }, defaultNextStepId: 'finish' },
  },
});
const routeState = createProcessState({ flow: routeFlow, processId: 'smoke-002' });
const dataStepR = plan(routeFlow, routeState);
const afterData = reduce(dataStepR, routeState, { writes: [] }); // no decision written → route ref will be missing
try {
  plan(routeFlow, afterData); // must throw FLOW_ROUTE_REF_NOT_RESOLVED
  throw new Error('ROUTE missing ref should throw');
} catch (e) {
  if (e.code !== 'FLOW_ROUTE_REF_NOT_RESOLVED') throw new Error('wrong ROUTE error: ' + e.code + ' — ' + e.message);
}

// ── Smoke 7: validateFlow rejects Flow3 step types ───────────────────────────
const vOld = validateFlow({ ...flowDef, steps: { ...flowDef.steps, evaluate: { ...flowDef.steps.evaluate, subtype: 'RULES' } } });
if (vOld.ok) throw new Error('PROCESS/RULES should be rejected in Flow 5');
if (!vOld.issues.some(i => i.code === 'FLOW_INVALID_SUBTYPE')) throw new Error('wrong code for RULES rejection');

// ── Smoke 8: EFFECT.onErrorStepId required ───────────────────────────────────
const vEffect = validateFlow({
  ...flowDef,
  steps: {
    ...flowDef.steps,
    evaluate: { ...flowDef.steps.evaluate, nextStepId: 'call_abs' },
    call_abs: { id: 'call_abs', type: 'EFFECT', subtype: 'CALL', title: 'Call', description: 'Calls ABS.', operationId: 'abs.find', inputRef: '$.context.input.application', nextStepId: 'finish' },
    // no onErrorStepId
  },
});
if (vEffect.ok) throw new Error('EFFECT without onErrorStepId should be rejected');
if (!vEffect.issues.some(i => i.code === 'FLOW_EFFECT_ON_ERROR_MISSING')) throw new Error('wrong code for missing onErrorStepId');

// ── Smoke 9: transition ref validation ───────────────────────────────────────
const vTransition = validateFlow({ ...flowDef, steps: { ...flowDef.steps, evaluate: { ...flowDef.steps.evaluate, nextStepId: 'NOPE' } } });
if (vTransition.ok) throw new Error('broken transition should be rejected');
if (!vTransition.issues.some(i => i.code === 'FLOW_TRANSITION_NOT_FOUND')) throw new Error('wrong code for broken transition');

// ── Smoke 10: XCompileError on invalid flow ───────────────────────────────────
try { prepareFlow({ ...flowDef, id: '' }); throw new Error('should throw'); }
catch (e) { if (!(e instanceof XCompileError)) throw new Error('wrong error class: ' + e?.constructor?.name); }


// ── Smoke 11: all packaged examples validate as Flow 5 ───────────────────────
import { readFileSync, readdirSync } from 'node:fs';
import { join as joinPath } from 'node:path';
const examplesDir = joinPath(process.cwd(), 'node_modules', '@processengine', 'semantics', 'examples');
for (const name of readdirSync(examplesDir).filter((x) => x.endsWith('.json'))) {
  const example = JSON.parse(readFileSync(joinPath(examplesDir, name), 'utf8'));
  const result = validateFlow(example);
  if (!result.ok) throw new Error('example does not validate: ' + name + ' ' + JSON.stringify(result.issues));
}

console.log('semantics smoke ok');
`;

writeFileSync(join(workdir, 'check.mjs'), script);
execFileSync('node', ['check.mjs'], { cwd: workdir, stdio: 'inherit' });
rmSync(join(root, tarball), { force: true });
