import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function packTarball(): { tarballPath: string; entries: string[] } {
  const packDir = createTempDir('flows-pack-');
  const packOutput = execFileSync('npm', ['pack', '--json', '--pack-destination', packDir], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  const parsed = JSON.parse(packOutput) as Array<{ filename: string }>;
  const tarballPath = path.join(packDir, parsed[0]!.filename);
  const entries = execFileSync('tar', ['-tf', tarballPath], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);

  return { tarballPath, entries };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('published package artifact', () => {
  it('includes required docs and excludes src', () => {
    const { entries } = packTarball();

    expect(entries).toContain('package/README.md');
    expect(entries).toContain('package/LICENSE');
    expect(entries).toContain('package/COMPATIBILITY.md');
    expect(entries).toContain('package/CHANGELOG.md');
    expect(entries).toContain('package/SPEC.md');
    expect(entries).toContain('package/SPEC_RU.md');
    expect(entries).toContain('package/docs/MIGRATION_GUIDE.md');
    expect(entries).toContain('package/docs/INTEGRATION_PERSISTENCE.md');
    expect(entries).toContain('package/docs/SCHEDULER_GUIDE.md');
    expect(entries.some((entry) => entry.startsWith('package/src/'))).toBe(false);
  });

  it('can be installed and imported from the packed tarball', { timeout: 60_000 }, () => {
    const { tarballPath } = packTarball();
    const installDir = createTempDir('flows-install-');

    writeFileSync(
      path.join(installDir, 'package.json'),
      JSON.stringify(
        {
          name: 'flows-install-smoke',
          private: true,
          type: 'module',
        },
        null,
        2,
      ),
    );

    execFileSync('npm', ['install', '--no-audit', '--no-fund', tarballPath], {
      cwd: installDir,
      stdio: 'pipe',
    });

    const script = `
      import {
        createProcessState,
        createFlowTrace,
        formatValidationIssues,
        prepareFlow,
        validateFlow
      } from '@processengine/semantics';

      const flow = {
        id: 'install.smoke',
        version: '2026-04-09',
        entryStepId: 'finish_success',
        steps: {
          finish_success: {
            id: 'finish_success',
            type: 'TERMINAL',
            subtype: 'COMPLETE',
            result: { status: 'COMPLETE', outcome: 'DONE' }
          }
        }
      };

      const validation = validateFlow(flow);
      if (!validation.isValid) throw new Error(formatValidationIssues(validation.errors));
      const prepared = prepareFlow(flow);
      const state = createProcessState({
        flow: prepared,
        processId: 'p-1'
      });

      const trace = createFlowTrace(state);
      if (trace !== null) {
        throw new Error('trace contract failed: expected null for traceMode off');
      }
    `;

    execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: installDir,
      stdio: 'pipe',
    });
  });
});
