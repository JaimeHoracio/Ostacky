import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { OstackyController } from '../assets/mcp/ostacky-controller/index.js';

const TMP_PREFIX = join(tmpdir(), 'ostacky-chaos-');
let tmp: string;

beforeEach(() => {
    tmp = mkdtempSync(TMP_PREFIX);
});
afterEach(() => {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe('chaos compaction', () => {
    it('simula experimental.session.compacting escribiendo fallback y get_handoff lo recupera', async () => {
        const statePath = join(tmp, '.opencode', 'ostacky-state.json');
        const fallbackPath = join(dirname(statePath), '.ostacky-handoff-compaction.json');
        // Simulate engram plugin compacting fallback write (same anchor as controller)
        const payload = {
            summary: 'Compaction fallback test',
            nextSteps: ['continue'],
            pendingTasks: ['T1'],
            ts: Date.now(),
            contextSnippet: 'test context',
        };
        const { mkdirSync } = await import('node:fs');
        mkdirSync(dirname(fallbackPath), { recursive: true });
        writeFileSync(fallbackPath, JSON.stringify(payload, null, 2), 'utf-8');

        // Controller with no lastHandoff should recover via fallback
        const c = new OstackyController({ statePath });
        const h = await c.getHandoff();
        expect(h?.summary).toBe('Compaction fallback test');
        expect(h?.pendingTasks).toEqual(['T1']);
    });

    it('clear_handoff borra fallback', async () => {
        const statePath = join(tmp, '.opencode', 'ostacky-state.json');
        const fallbackPath = join(dirname(statePath), '.ostacky-handoff-compaction.json');
        const { mkdirSync } = await import('node:fs');
        mkdirSync(dirname(fallbackPath), { recursive: true });
        writeFileSync(fallbackPath, JSON.stringify({ summary: 'to-clear', ts: Date.now() }), 'utf-8');
        const c = new OstackyController({ statePath });
        // set a handoff first to have state, then clear
        await c.setHandoff({ summary: 'manual' });
        const cleared = await c.clearHandoff();
        expect(cleared.ok).toBe(true);
        expect(existsSync(fallbackPath)).toBe(false);
        const h2 = await c.getHandoff();
        expect(h2).toBeNull();
    });
});
