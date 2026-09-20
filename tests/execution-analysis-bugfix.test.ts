import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OstackyController } from '../assets/mcp/ostacky-controller/index.js';

const TMP_PREFIX = join(tmpdir(), 'exec-bugfix-');
let tmp: string;
beforeEach(() => { tmp = mkdtempSync(TMP_PREFIX); });
afterEach(() => { if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true }); });

function validSnapshot(overrides: any = {}) {
  return {
    recommendation: 'INLINE',
    reasons: ['Regla 1: cluster único'],
    codegraphUsed: ['codegraph_codegraph_explore'],
    taskCount: 3,
    expectedTaskIds: ['T1', 'T2', 'T3'],
    sharedFiles: {},
    fileClusters: [['T1'], ['T2'], ['T3']],
    clusterCount: 3,
    sequentialDeps: [],
    estLines: 20,
    hasExplicitContract: false,
    filesPerTask: { T1: ['src/a.ts'], T2: ['src/b.ts'], T3: ['src/c.ts'] },
    globalRuleTriggered: '3a',
    reasoning: { files: ['src/a.ts'], estLines: 20 },
    ...overrides,
  };
}

describe('execution-analysis-bugfix: no BLOCKED con snapshot válido', () => {
  it('snapshot válido completo avanza a EXECUTION_DECISION_PENDING sin retryAllowed ni BLOCKED', async () => {
    const statePath = join(tmp, 'state-valid.json');
    const c = new OstackyController({ statePath, initialState: { state: 'EXECUTION_ANALYSIS', degraded: false, audit: [], auditSeq: 0 } as any });
    const res: any = await c.recordExecutionAnalysis({ executionDecisionId: 'e-valid', snapshot: validSnapshot() as any });
    expect(res.error).toBeUndefined();
    expect(res.retryAllowed).toBeUndefined();
    expect(res.state).toBe('EXECUTION_DECISION_PENDING');
    const s = await c.getState();
    expect(s.state).toBe('EXECUTION_DECISION_PENDING');
    expect(s.snapshots.execution).toBeDefined();
  });

  it('snapshot missing recommendation/reasons retorna retryAllowed y permite retry sin BLOCKED', async () => {
    const statePath = join(tmp, 'state-missing-rec.json');
    const c = new OstackyController({ statePath, initialState: { state: 'EXECUTION_ANALYSIS', degraded: false, audit: [], auditSeq: 0 } as any });
    const err: any = await c.recordExecutionAnalysis({ executionDecisionId: 'e-missing', snapshot: { taskCount: 5, codegraphUsed: ['x'], expectedTaskIds: ['T1','T2','T3','T4','T5'] } as any });
    expect(err.error).toContain('Snapshot missing recommendation/reasons');
    expect(err.retryAllowed).toBe(true);
    expect(err.current_state).toBe('EXECUTION_ANALYSIS');
    expect(err.available_transitions).toContain('record_execution_analysis');
    // Estado debe seguir en EXECUTION_ANALYSIS, no BLOCKED
    const s1 = await c.getState();
    expect(s1.state).toBe('EXECUTION_ANALYSIS');
    // Retry con snapshot válido debe avanzar
    const ok: any = await c.recordExecutionAnalysis({ executionDecisionId: 'e-missing', snapshot: validSnapshot({ taskCount: 5, expectedTaskIds: ['T1','T2','T3','T4','T5'], codegraphUsed: ['x'] }) as any });
    expect(ok.state).toBe('EXECUTION_DECISION_PENDING');
    expect(ok.error).toBeUndefined();
  });

  it('snapshot missing expectedTaskIds con taskCount>0 ahora retorna retryAllowed (antes era BLOCKED sin retry)', async () => {
    const statePath = join(tmp, 'state-missing-ids.json');
    const c = new OstackyController({ statePath, initialState: { state: 'EXECUTION_ANALYSIS', degraded: false, audit: [], auditSeq: 0 } as any });
    const err: any = await c.recordExecutionAnalysis({
      executionDecisionId: 'e-ids',
      snapshot: {
        recommendation: 'INLINE',
        reasons: ['test'],
        codegraphUsed: ['x'],
        taskCount: 5,
        // sin expectedTaskIds ni taskIds -> debe dar retryAllowed
      } as any,
    });
    expect(err.error).toContain('Snapshot missing expectedTaskIds');
    expect(err.retryAllowed).toBe(true);
    expect(err.current_state).toBe('EXECUTION_ANALYSIS');
    const s = await c.getState();
    expect(s.state).toBe('EXECUTION_ANALYSIS'); // no BLOCKED
    // Retry con ids correctos avanza
    const ok: any = await c.recordExecutionAnalysis({
      executionDecisionId: 'e-ids',
      snapshot: validSnapshot({ taskCount: 5, expectedTaskIds: ['T1','T2','T3','T4','T5'] }) as any,
    });
    expect(ok.state).toBe('EXECUTION_DECISION_PENDING');
  });

  it('snapshot con alias mode/reason es normalizado y no bloquea', async () => {
    const statePath = join(tmp, 'state-alias.json');
    const c = new OstackyController({ statePath, initialState: { state: 'EXECUTION_ANALYSIS', degraded: false, audit: [], auditSeq: 0 } as any });
    const res: any = await c.recordExecutionAnalysis({
      executionDecisionId: 'e-alias',
      snapshot: {
        mode: 'INLINE',
        reason: 'Regla 3a',
        codegraphUsed: ['x'],
        taskCount: 3,
        expectedTaskIds: ['T1','T2','T3'],
        sharedFiles: {},
        fileClusters: [['T1'],['T2'],['T3']],
        clusterCount: 3,
        sequentialDeps: [],
        estLines: 10,
        hasExplicitContract: false,
        filesPerTask: {},
      } as any,
    });
    expect(res.error).toBeUndefined();
    expect(res.state).toBe('EXECUTION_DECISION_PENDING');
  });

  it('reasons vacío se considera missing y retorna retryAllowed', async () => {
    const statePath = join(tmp, 'state-empty-reasons.json');
    const c = new OstackyController({ statePath, initialState: { state: 'EXECUTION_ANALYSIS', degraded: false, audit: [], auditSeq: 0 } as any });
    const err: any = await c.recordExecutionAnalysis({
      executionDecisionId: 'e-empty',
      snapshot: {
        recommendation: 'INLINE',
        reasons: [],
        codegraphUsed: ['x'],
        taskCount: 3,
        expectedTaskIds: ['T1','T2','T3'],
      } as any,
    });
    expect(err.error).toContain('Snapshot missing recommendation/reasons');
    expect(err.retryAllowed).toBe(true);
    const s = await c.getState();
    expect(s.state).toBe('EXECUTION_ANALYSIS');
  });

  it('snapshot válido no genera degraded ni requiere validación inline manual', async () => {
    const statePath = join(tmp, 'state-no-degraded.json');
    mkdirSync(join(tmp, '.opencode'), { recursive: true });
    const c = new OstackyController({ statePath });
    await c.startRequest({ requestId: 'valid-flow' });
    await c.recordDiscovery({ level: '0+1', routeDecisionId: 'r', snapshot: { symbols: [{ name: 'x', kind: 'fn', file: 'src/a.ts' }], files: ['src/a.ts'], callPaths: [] } as any });
    await c.consumeRouteDecision({ decisionId: 'r', choice: 'DIRECT' });
    // Ahora en EXECUTION_ANALYSIS
    const res: any = await c.recordExecutionAnalysis({ executionDecisionId: 'e-flow', snapshot: validSnapshot() as any });
    expect(res.state).toBe('EXECUTION_DECISION_PENDING');
    expect(res.warning).toBeUndefined(); // no snapshot_defaulted
    await c.consumeExecutionDecision({ decisionId: 'e-flow', mode: 'INLINE' });
    const m = await c.getMetrics();
    expect(m.degradedEditsCount).toBe(0);
    expect(m.codegraphBypassCount).toBe(0); // snapshot trae codegraphUsed
  });

  it('snapshot stringified JSON es parseado y no bloquea si es válido', async () => {
    const statePath = join(tmp, 'state-string.json');
    const c = new OstackyController({ statePath, initialState: { state: 'EXECUTION_ANALYSIS', degraded: false, audit: [], auditSeq: 0 } as any });
    const json = JSON.stringify(validSnapshot());
    const res: any = await c.recordExecutionAnalysis({ executionDecisionId: 'e-str', snapshot: json as any });
    expect(res.state).toBe('EXECUTION_DECISION_PENDING');
    expect(res.error).toBeUndefined();
  });
});
