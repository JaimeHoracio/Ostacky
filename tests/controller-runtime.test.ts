import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OstackyController } from '../assets/mcp/ostacky-controller/index.js';
import { pruneStaleSkills } from '../src/installer.js';

const TMP_PREFIX = join(tmpdir(), 'ostacky-runtime-');
let tmp: string;

beforeEach(() => {
    tmp = mkdtempSync(TMP_PREFIX);
});

afterEach(() => {
    try {
        chmodSync(tmp, 0o755);
    } catch {
        /* dir may not exist */
    }
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe('B2: handoff persistence', () => {
    it('setHandoff persists and returns the handoff with timestamp', async () => {
        const c = new OstackyController({ initialState: {} });
        const result = await c.setHandoff({ summary: 'Implementing v0.7.3', nextSteps: ['a', 'b'] });
        expect(result.ok).toBe(true);
        expect(result.lastHandoff.summary).toBe('Implementing v0.7.3');
        expect(result.lastHandoff.nextSteps).toEqual(['a', 'b']);
        expect(typeof result.lastHandoff.ts).toBe('number');
        expect(result.lastHandoff.pendingTasks).toEqual([]);
    });

    it('getHandoff returns the most recently set handoff', async () => {
        const c = new OstackyController({ initialState: {} });
        await c.setHandoff({ summary: 'first' });
        await c.setHandoff({ summary: 'second' });
        const h = await c.getHandoff();
        expect(h?.summary).toBe('second');
    });

    it('clearHandoff resets to null and returns the cleared value', async () => {
        const c = new OstackyController({ initialState: {} });
        await c.setHandoff({ summary: 'test' });
        const result = await c.clearHandoff();
        expect(result.ok).toBe(true);
        expect(result.cleared?.summary).toBe('test');
        const after = await c.getHandoff();
        expect(after).toBeNull();
    });

    it('setHandoff without summary returns error', async () => {
        const c = new OstackyController({ initialState: {} });
        const result = await c.setHandoff({});
        expect(result.error).toContain('summary');
    });

    it('handoff persists across controller instances (real file)', async () => {
        const statePath = join(tmp, 'state.json');
        const c1 = new OstackyController({ statePath });
        await c1.setHandoff({ summary: 'cross-instance test', pendingTasks: ['task-1'] });
        // Create new instance pointing to same file
        const c2 = new OstackyController({ statePath });
        const h = await c2.getHandoff();
        expect(h?.summary).toBe('cross-instance test');
        expect(h?.pendingTasks).toEqual(['task-1']);
    });
});

describe('B1: consecutiveFailures and degraded mode', () => {
    it('starts in non-degraded mode', () => {
        const c = new OstackyController({ initialState: {} });
        expect(c.degraded).toBe(false);
    });

    it.skipIf(process.platform === 'win32')(
        'enters degraded mode after 3 consecutive persist failures',
        async () => {
            const statePath = join(tmp, 'subdir-not-existent-yet', 'state.json');
            // Use lockMaxAttempts: 1 so lock failures return immediately (no ~26s retry)
            const c = new OstackyController({ statePath, lockMaxAttempts: 1 });

            // Trigger 3 failed persists by making the dir read-only after first persist fails
            // First write the file successfully to establish baseline
            await c.setHandoff({ summary: 'first' });
            expect(c.degraded).toBe(false);

            // Now remove write permissions so subsequent persists fail fast
            const parentDir = join(tmp, 'subdir-not-existent-yet');
            chmodSync(parentDir, 0o555);

            // Silence expected stderr noise from controller's log() during this test
            const origConsoleError = console.error;
            console.error = () => {};
            try {
                for (let i = 0; i < 3; i++) {
                    try {
                        await c.setHandoff({ summary: `fail-${i}` });
                    } catch {
                        /* expected — persist throws after incrementing failure counter */
                    }
                }
                expect(c.degraded).toBe(true);
            } finally {
                console.error = origConsoleError;
                chmodSync(parentDir, 0o755);
            }
        },
        { timeout: 30_000 }
    ); // 3 fails × ~100ms with lockMaxAttempts=1
});

describe('T1: async lock — contention (no busy-wait)', () => {
    it(
        'handles concurrent persists without corruption and stays responsive',
        async () => {
            const statePath = join(tmp, 'contention-state.json');
            const writers = Array.from({ length: 4 }, () => new OstackyController({ statePath }));
            // concurrent burst — exercises async lock with jitter
            await Promise.all(writers.map((c, i) => c.setHandoff({ summary: `writer-${i}-${Date.now()}` })));
            const c = new OstackyController({ statePath });
            for (let i = 0; i < 12; i++) await c.setHandoff({ summary: `seq-${i}` });
            const raw = readFileSync(statePath, 'utf8');
            expect(() => JSON.parse(raw)).not.toThrow();
            const t0 = Date.now();
            await c.getState();
            expect(Date.now() - t0).toBeLessThan(500);
        },
        { timeout: 15000 }
    );
});

describe('B5: getAvailableTransitions', () => {
    it('returns the 4 transitions from INTERPRETATION_PENDING', async () => {
        const c = new OstackyController({ initialState: {} });
        const t = await c.getAvailableTransitions();
        expect(t.currentState).toBe('INTERPRETATION_PENDING');
        expect(t.transitions.length).toBe(4);
        const vias = t.transitions.map((x: any) => x.via);
        expect(vias).toContain('request_clarification');
        expect(vias).toContain('proceed_to_discovery');
        expect(vias).toContain('record_discovery');
        expect(vias).toContain('block');
    });

    it('returns empty array for terminal state DONE', async () => {
        const c = new OstackyController({ initialState: { state: 'DONE' } });
        const t = await c.getAvailableTransitions();
        expect(t.currentState).toBe('DONE');
        expect(t.transitions.length).toBe(0);
    });

    it('includes choice for consume_route_decision', async () => {
        const c = new OstackyController({ initialState: { state: 'ROUTE_DECISION_PENDING' } });
        const t = await c.getAvailableTransitions();
        const consume = t.transitions.find((x: any) => x.via === 'consume_route_decision');
        expect(consume).toBeDefined();
        expect(consume.choice).toBeDefined();
    });
});

describe('O2: defaultChoice persistence', () => {
    it('recordDiscovery persists routeChoice and level', async () => {
        const statePath = join(tmp, 'state.json');
        const c = new OstackyController({ statePath });
        await c.startRequest({ requestId: 'test-1' });
        await c.recordDiscovery({ level: '1+', routeDecisionId: 'rd-1' });
        const s = await c.getState();
        expect(s.level).toBe('1+');
        expect(s.routeChoice).toBe('SPEC');
    });

    it('recordDiscovery with level 0 sets routeChoice to DIRECT', async () => {
        const statePath = join(tmp, 'state.json');
        const c = new OstackyController({ statePath });
        await c.startRequest({ requestId: 'test-2' });
        await c.recordDiscovery({ level: '0', routeDecisionId: 'rd-2' });
        const s = await c.getState();
        expect(s.level).toBe('0');
        expect(s.routeChoice).toBe('DIRECT');
    });
});

describe('B3: pruneStaleSkills', () => {
    it('removes skill directories not declared in the manifest', async () => {
        const skillsDir = join(tmp, 'skills');
        const { mkdirSync } = await import('node:fs');
        mkdirSync(join(skillsDir, 'writing-plans'), { recursive: true });
        mkdirSync(join(skillsDir, 'openspec-sync-specs'), { recursive: true });
        mkdirSync(join(skillsDir, 'brainstorming'), { recursive: true });
        writeFileSync(join(skillsDir, 'writing-plans', 'SKILL.md'), 'stale');
        writeFileSync(join(skillsDir, 'openspec-sync-specs', 'SKILL.md'), 'stale');
        writeFileSync(join(skillsDir, 'brainstorming', 'SKILL.md'), 'valid');

        // Minimal manifest with only brainstorming
        const manifest = {
            agents: [],
            commands: [],
            mcpServers: [],
            skills: [{ name: 'brainstorming', version: '0.7.3' }],
        };
        const paths = {
            root: tmp,
            agents: '',
            commands: '',
            skills: skillsDir,
            mcp: '',
            tools: '',
        };
        const removed = pruneStaleSkills(paths, manifest);
        expect(removed.sort()).toEqual(['openspec-sync-specs', 'writing-plans']);
        expect(existsSync(join(skillsDir, 'writing-plans'))).toBe(false);
        expect(existsSync(join(skillsDir, 'openspec-sync-specs'))).toBe(false);
        expect(existsSync(join(skillsDir, 'brainstorming'))).toBe(true);
    });

    it('returns empty array when no stale skills exist', async () => {
        const skillsDir = join(tmp, 'skills-empty');
        const { mkdirSync } = await import('node:fs');
        mkdirSync(join(skillsDir, 'brainstorming'), { recursive: true });
        const manifest = {
            agents: [],
            commands: [],
            mcpServers: [],
            skills: [{ name: 'brainstorming', version: '0.7.3' }],
        };
        const paths = {
            root: tmp,
            agents: '',
            commands: '',
            skills: skillsDir,
            mcp: '',
            tools: '',
        };
        const removed = pruneStaleSkills(paths, manifest);
        expect(removed).toEqual([]);
    });

    it('handles missing skills directory gracefully', () => {
        const skillsDir = join(tmp, 'nonexistent-skills');
        const manifest = { agents: [], commands: [], mcpServers: [], skills: [] };
        const paths = {
            root: tmp,
            agents: '',
            commands: '',
            skills: skillsDir,
            mcp: '',
            tools: '',
        };
        const removed = pruneStaleSkills(paths, manifest);
        expect(removed).toEqual([]);
    });
});
