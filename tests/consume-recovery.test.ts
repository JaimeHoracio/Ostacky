import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OstackyController } from '../assets/mcp/ostacky-controller/index.js';

const TMP_PREFIX = join(tmpdir(), 'consume-recovery-');
let tmp: string;
beforeEach(() => { tmp = mkdtempSync(TMP_PREFIX); });
afterEach(() => { if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true }); });

function routePending(statePath: string, routeDecisionId = 'route-stale') {
  return new OstackyController({
    statePath,
    initialState: {
      state: 'ROUTE_DECISION_PENDING',
      routeDecisionId,
      audit: [],
      auditSeq: 0,
    } as any,
  });
}

describe('consume-recovery: approved-but-blocked sin deadlock', () => {
  it('3 consumes con ID viejo cuentan fallos y el 3ro trae recovery hint', async () => {
    const statePath = join(tmp, 'state-mismatch.json');
    const c = routePending(statePath);
    let res: any;
    for (let i = 0; i < 3; i++) {
      res = await c.consumeRouteDecision({ decisionId: 'route-wrong', choice: 'DIRECT' });
      expect(res.error).toContain('Decision ID mismatch');
    }
    expect(res.recovery).toContain('refresh_decision');
    const s = await c.getState();
    expect(s.consumeFailedCount).toBe(3);
  });

  it('los fallos quedan auditados en disco aunque el proceso muera (flush sync)', async () => {
    const statePath = join(tmp, 'state-durable.json');
    const c = routePending(statePath);
    await c.consumeRouteDecision({ decisionId: 'route-wrong', choice: 'DIRECT' });
    // Nueva instancia = simula restart del MCP: el buffer en memoria se perdió,
    // lo que esté en disco es lo único que sobrevivió.
    const c2 = new OstackyController({ statePath } as any);
    const s2: any = await c2.getState();
    const fails = (s2.audit || []).filter((e: any) => e.decision === 'consume_failed');
    expect(fails.length).toBe(1);
    expect(s2.consumeFailedCount).toBe(1);
  });

  it('refresh_decision regenera el ID y el consume con ID fresco avanza', async () => {
    const statePath = join(tmp, 'state-refresh.json');
    const c = routePending(statePath);
    await c.consumeRouteDecision({ decisionId: 'route-wrong', choice: 'DIRECT' });
    const ref: any = await c.refreshDecision();
    expect(ref.error).toBeUndefined();
    expect(ref.routeDecisionId).toBeDefined();
    expect(ref.routeDecisionId).not.toBe('route-stale');
    const ok: any = await c.consumeRouteDecision({ decisionId: ref.routeDecisionId, choice: 'DIRECT' });
    expect(ok.error).toBeUndefined();
    expect(ok.state).toBe('EXECUTION_ANALYSIS');
    const s = await c.getState();
    expect(s.consumeFailedCount).toBe(0);
  });

  it('refresh_decision fuera de PENDING devuelve error sin mutar', async () => {
    const statePath = join(tmp, 'state-nopending.json');
    const c = new OstackyController({
      statePath,
      initialState: { state: 'DISCOVERY', audit: [], auditSeq: 0 } as any,
    });
    const res: any = await c.refreshDecision();
    expect(res.error).toContain('No decision to refresh');
    const s = await c.getState();
    expect(s.state).toBe('DISCOVERY');
  });

  it('mismatch en ejecución también cuenta y refresh repara el exec ID', async () => {
    const statePath = join(tmp, 'state-exec.json');
    const c = new OstackyController({
      statePath,
      initialState: {
        state: 'EXECUTION_DECISION_PENDING',
        executionDecisionId: 'exec-stale',
        audit: [],
        auditSeq: 0,
      } as any,
    });
    const r1: any = await c.consumeExecutionDecision({ decisionId: 'exec-wrong', mode: 'INLINE' });
    expect(r1.error).toContain('Decision ID mismatch');
    expect(r1.recovery).toBeUndefined(); // 1 < umbral 3
    await c.consumeExecutionDecision({ decisionId: 'exec-wrong', mode: 'INLINE' });
    const r3: any = await c.consumeExecutionDecision({ decisionId: 'exec-wrong', mode: 'INLINE' });
    expect(r3.recovery).toContain('refresh_decision');
    const ref: any = await c.refreshDecision();
    expect(ref.executionDecisionId).not.toBe('exec-stale');
    const ok: any = await c.consumeExecutionDecision({ decisionId: ref.executionDecisionId, mode: 'INLINE' });
    expect(ok.error).toBeUndefined();
    expect(ok.state).toBe('EXECUTING_INLINE');
  });
});
