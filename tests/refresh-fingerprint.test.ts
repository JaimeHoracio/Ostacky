import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OstackyController } from '../assets/mcp/ostacky-controller/index.js';

const TMP_PREFIX = join(tmpdir(), 'ostacky-refresh-');
let tmp: string;
beforeEach(() => { tmp = mkdtempSync(TMP_PREFIX); });
afterEach(() => { if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true }); });

function baseState(state: string) {
  return { state, tasks: {}, expectedTasks: ['T1'], expectedTaskCount: 1, audit: [], auditSeq: 0 } as any;
}

describe('refresh_fingerprint: revalidación sin churn', () => {
  it('INLINE: archivo refinado tras complete -> stale -> refresh -> ok sin force', async () => {
    const statePath = join(tmp, '.opencode', 'ostacky-state.json');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(tmp, '.opencode'), { recursive: true });
    const c = new OstackyController({ statePath, initialState: baseState('EXECUTING_INLINE') });
    const p = join(tmp, 'a.ts');
    writeFileSync(p, 'v1', 'utf-8');
    await c.completeTask({ taskId: 'T1', filePath: p });
    // refino posterior al complete (flujo normal)
    writeFileSync(p, 'v1 refinado', 'utf-8');
    const stale = await c.verifyIntegrity();
    expect(stale.staleFiles.length).toBeGreaterThan(0);
    const blocked = await c.implementationComplete({});
    expect(blocked.error).toMatch(/stale/i);
    // refresh honesto sin reeditar
    const r: any = await (c as any).refreshFingerprint({ filePath: p });
    expect(r.ok).toBe(true);
    const ok = await c.verifyIntegrity();
    expect(ok.ok).toBe(true);
    expect(ok.staleFiles.length).toBe(0);
    const done = await c.implementationComplete({});
    expect(done.state).toBe('SYNC');
    expect((done as any).forced).toBeFalsy();
  });

  it('SUBAGENTS: mismo flujo sin force', async () => {
    const statePath = join(tmp, '.opencode2', 'ostacky-state.json');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(tmp, '.opencode2'), { recursive: true });
    const c = new OstackyController({ statePath, initialState: baseState('EXECUTING_SUBAGENTS') });
    const p = join(tmp, 'b.ts');
    writeFileSync(p, 'v1', 'utf-8');
    await c.completeTask({ taskId: 'T1', filePath: p });
    writeFileSync(p, 'v1 + polish', 'utf-8');
    expect((await c.verifyIntegrity()).staleFiles.length).toBeGreaterThan(0);
    const r: any = await (c as any).refreshFingerprint({ filePath: p });
    expect(r.ok).toBe(true);
    expect((await c.verifyIntegrity()).ok).toBe(true);
    const done = await c.implementationComplete({});
    expect(done.state).toBe('SYNC');
  });

  it('SPECIFICATION: refresh también vale en spec (ruta SPEC)', async () => {
    const statePath = join(tmp, '.opencode3', 'ostacky-state.json');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(tmp, '.opencode3'), { recursive: true });
    const c = new OstackyController({ statePath, initialState: baseState('SPECIFICATION') });
    const p = join(tmp, 'spec-a.ts');
    writeFileSync(p, 'v1', 'utf-8');
    // en SPECIFICATION también se puede refrescar sin churn
    const r: any = await (c as any).refreshFingerprint({ filePath: p });
    expect(r.ok).toBe(true);
    expect(r.fingerprint).toBeTruthy();
  });

  it('taskId solo: resuelve filePath del task', async () => {
    const statePath = join(tmp, '.opencode4', 'ostacky-state.json');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(tmp, '.opencode4'), { recursive: true });
    const c = new OstackyController({ statePath, initialState: baseState('EXECUTING_INLINE') });
    const p = join(tmp, 'c.ts');
    writeFileSync(p, 'v1', 'utf-8');
    await c.completeTask({ taskId: 'T1', filePath: p });
    writeFileSync(p, 'v1 refinado', 'utf-8');
    expect((await c.verifyIntegrity()).staleFiles.length).toBeGreaterThan(0);
    const r: any = await (c as any).refreshFingerprint({ taskId: 'T1' });
    expect(r.ok).toBe(true);
    expect(r.filePath).toBe(p);
    expect((await c.verifyIntegrity()).ok).toBe(true);
  });
});

describe('plugin gates: no bloquear revalidación honesta', () => {
  const pluginPath = join(import.meta.dir, '..', 'assets', 'plugins', 'ostacky-controller', 'index.ts');
  const mcpPath = join(import.meta.dir, '..', 'assets', 'mcp', 'ostacky-controller', 'index.js');
  it('shell gate excluye 2>&1 (stderr no es mutación)', () => {
    const src = readFileSync(pluginPath, 'utf-8');
    expect(src).toContain('2>&1');
    expect(src).toContain('cmdSansStderr');
  });
  it('discovery gate exime task-tracked y docs', () => {
    const src = readFileSync(pluginPath, 'utf-8');
    expect(src).toContain('isTaskTracked');
    expect(src).toContain('isDocsPath');
  });
  it('mcp expone refresh_fingerprint', () => {
    const src = readFileSync(mcpPath, 'utf-8');
    expect(src).toContain("'refresh_fingerprint'");
    expect(src).toContain('refreshFingerprint');
  });
});
