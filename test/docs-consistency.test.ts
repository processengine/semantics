import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as publicApi from '../src/index.js';
import { prepareFlow, validateFlow, type FlowDefinition } from '../src/index.js';

function readRepoFile(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

function findMarkdownTargets(content: string): string[] {
  return [...content.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)]
    .map((match) => match[1] ?? '')
    .filter((target) => target !== '' && !target.startsWith('http') && !target.startsWith('#') && !target.startsWith('mailto:'));
}

describe('examples and docs stay aligned with the canonical public contract', () => {
  it('all example flows validate and prepare with the current public contract', () => {
    const examplesDir = new URL('../examples/', import.meta.url);
    const files = readdirSync(examplesDir).filter((file) => file.endsWith('.json')).sort();

    for (const file of files) {
      const flow = JSON.parse(readFileSync(new URL(`../examples/${file}`, import.meta.url), 'utf8')) as FlowDefinition;
      const validation = validateFlow(flow);

      expect(validation.isValid, file).toBe(true);
      expect(() => prepareFlow(flow), file).not.toThrow();
    }
  });

  it('public docs do not describe the legacy runtime API or pre-canon contracts', () => {
    const files = [
      'README.md',
      'SPEC.md',
      'SPEC_RU.md',
      'docs/BENCHMARKS.md',
      'docs/INTEGRATION_PERSISTENCE.md',
      'docs/SCHEDULER_GUIDE.md',
      'benchmarks/run.mjs',
    ];

    const forbiddenPatterns = [
      /FlowSnapshot/u,
      /createRuntime/u,
      /createSnapshot/u,
      /restoreSnapshot/u,
      /runtime\.step/u,
      /runtime\.handleEvent/u,
      /runtime\.handleTimeout/u,
      /steps:\s*\[/u,
    ];

    for (const file of files) {
      const content = readRepoFile(file);
      for (const pattern of forbiddenPatterns) {
        expect(content, `${file} should not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it('README documents only current public exports and canonical semantics', () => {
    const content = readRepoFile('README.md');
    const exportedFunctions = [
      'validateFlow',
      'prepareFlow',
      'createProcessState',
      'plan',
      'reduce',
      'apply',
      'resume',
      'formatValidationIssues',
    ] as const;

    for (const name of exportedFunctions) {
      expect(name in publicApi).toBe(true);
      expect(content).toMatch(new RegExp(`\\b${name}\\b`, 'u'));
    }

    expect(content).toMatch(/`steps` is an object map/u);
    expect(content).toMatch(/WAIT\/MESSAGE/u);
    expect(content).toMatch(/operationId/u);
    expect(content).toMatch(/ACTIVE \| WAITING \| COMPLETE \| FAIL/u);
    expect(content).toMatch(/import\s*\{[\s\S]*\bcreateProcessState\b[\s\S]*\}\s*from '@processengine\/semantics'/u);
  });

  it('SPEC and SPEC_RU describe the same canonical lifecycle', () => {
    const spec = readRepoFile('SPEC.md');
    const specRu = readRepoFile('SPEC_RU.md');

    for (const phrase of ['WAIT/MESSAGE', 'operationId', 'ACTIVE', 'XCompileError', 'XRuntimeError', 'requestId', 'selectedNextStepId', 'traceMode']) {
      expect(spec).toContain(phrase);
      expect(specRu).toContain(phrase);
    }

    expect(spec).toContain('must be a non-empty object');
    expect(specRu).toContain('должен быть непустым объектом');
  });

  it('markdown docs link only to files that exist in the repository', () => {
    const markdownFiles = [
      'README.md',
      'COMPATIBILITY.md',
      'CHANGELOG.md',
      'SPEC.md',
      'SPEC_RU.md',
      'docs/BENCHMARKS.md',
      'docs/INTEGRATION_PERSISTENCE.md',
      'docs/MIGRATION_GUIDE.md',
      'docs/SCHEDULER_GUIDE.md',
    ];
    const repoRoot = path.resolve(new URL('../', import.meta.url).pathname);

    for (const file of markdownFiles) {
      const sourceUrl = new URL(`../${file}`, import.meta.url);
      const content = readRepoFile(file);

      for (const target of findMarkdownTargets(content)) {
        const [relativeTarget] = target.split('#');
        if (!relativeTarget) continue;
        const resolved = new URL(relativeTarget, sourceUrl);
        const relativeResolved = path.relative(repoRoot, resolved.pathname);

        expect(existsSync(resolved), `${file} -> ${relativeTarget} (${relativeResolved})`).toBe(true);
      }
    }
  });
});
