import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { OstackyController, parseTasksMd } from '../assets/mcp/ostacky-controller/index.js';

const TMP_PREFIX = join(tmpdir(), 'ostacky-harden-');
let tmp: string;

beforeEach(() => {
    tmp = mkdtempSync(TMP_PREFIX);
});

afterEach(() => {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

function writeTasks(changeId: string, lines: string[]) {
    const dir = join(tmp, 'openspec', 'changes', changeId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'tasks.md'), lines.join('\n'), 'utf-8');
}

describe('harden-task-integrity: parseTasksMd', () => {
    it('parses harden-task-integrity tasks.md numeric ids', async () => {
        // use real project tasks.md
        const realPath = resolve('.opencode', 'ostacky-state.json');
        // the changeId is harden-task-integrity — file exists in repo
        const ids = parseTasksMd('harden-task-integrity', realPath);
        // should capture 1.1,1.2,1.3,2.1,2.2,2.3,3.1 (7 ids)
        expect(ids.length).toBe(7);
        expect(ids).toContain('1.1');
        expect(ids).toContain('2.2');
        expect(ids).toContain('3.1');
    });

    it('parses T-prefixed tasks in temp project', async () => {
        const statePath = join(tmp, '.opencode', 'ostacky-state.json');
        mkdirSync(join(tmp, '.opencode'), { recursive: true });
        writeTasks('test-change', [
            '# Tasks: test-change',
            '## 1. Group',
            '- [ ] T1 first task',
            '- [ ] T2 second',
            '- [x] T3 done',
            '## 2. Other',
            '- [ ] T4 last',
        ]);
        const ids = parseTasksMd('test-change', statePath);
        expect(ids).toEqual(['T1', 'T2', 'T3', 'T4']);
    });

    it('returns [] when changeId missing or file not found', async () => {
        const statePath = join(tmp, '.opencode', 'ostacky-state.json');
        expect(parseTasksMd('', statePath)).toEqual([]);
        expect(parseTasksMd('non-existent', statePath)).toEqual([]);
        expect(parseTasksMd(null as any, statePath)).toEqual([]);
    });
});

describe('harden-task-integrity: tasks.md canonical in recordExecutionAnalysis', () => {
    it('snapshot with fewer tasks than tasks.md -> WARN task_count_mismatch and uses tasks.md', async () => {
        const statePath = join(tmp, '.opencode', 'ostacky-state.json');
        mkdirSync(join(tmp, '.opencode'), { recursive: true });
        writeTasks('harden-task-integrity', [
            '# Tasks: harden-task-integrity',
            '- [ ] 1.1 a',
            '- [ ] 1.2 b',
            '- [ ] 1.3 c',
            '- [ ] 2.1 d',
            '- [ ] 2.2 e',
            '- [ ] 2.3 f',
            '- [ ] 3.1 g',
        ]);
        const c = new OstackyController({ statePath });
        await c.startRequest({ requestId: 'test-mismatch', changeId: 'harden-task-integrity', force: true });
        // need DISCOVERY -> ROUTE -> SPEC -> EXECUTION_ANALYSIS minimal path
        // recordDiscovery to get to ROUTE_DECISION_PENDING
        await c.recordDiscovery({ level: '1+', snapshot: { symbols: [{ name: 'x', kind: 'function', file: 'src/a.ts' }], reasoning: { files: ['src/a.ts'], estLines: 40 } } as any });
        await c.consumeRouteDecision({ decisionId: (await c.getState()).routeDecisionId, choice: 'SPEC' });
        await c.specComplete();
        // now EXECUTION_ANALYSIS
        const res = await c.recordExecutionAnalysis({
            snapshot: {
                recommendation: 'INLINE',
                reasons: ['test'],
                codegraphUsed: ['discovery-cache'],
                taskCount: 2,
                expectedTaskIds: ['1.1', '1.2'],
            } as any,
        });
        const state = await c.getState();
        // should be overridden to 7 from tasks.md
        expect(state.expectedTasks?.length).toBe(7);
        expect(state.expectedTasks).toContain('2.3');
        // audit should contain WARN
        const audit = await c.getAudit({ limit: 20 });
        const warn = audit.find((e: any) => e.decision === 'task_count_mismatch');
        expect(warn).toBeDefined();
        expect(warn?.phase).toBe('WARN');
    });

    it('snapshot matching tasks.md does not warn', async () => {
        const statePath = join(tmp, '.opencode', 'ostacky-state.json');
        mkdirSync(join(tmp, '.opencode'), { recursive: true });
        writeTasks('match-change', [
            '- [ ] T1 a',
            '- [ ] T2 b',
        ]);
        const c = new OstackyController({ statePath });
        await c.startRequest({ requestId: 'test-match', changeId: 'match-change', force: true });
        await c.recordDiscovery({ level: '0+1', snapshot: { symbols: [{ name: 'x', kind: 'fn', file: 'src/a.ts' }], reasoning: { files: ['src/a.ts'], estLines: 20 } } as any });
        await c.consumeRouteDecision({ decisionId: (await c.getState()).routeDecisionId, choice: 'DIRECT' });
        // DIRECT goes to EXECUTION_ANALYSIS directly
        const res = await c.recordExecutionAnalysis({
            snapshot: {
                recommendation: 'INLINE',
                reasons: ['small'],
                codegraphUsed: ['codegraph_codegraph_explore'],
                taskCount: 2,
                expectedTaskIds: ['T1', 'T2'],
            } as any,
        });
        const state = await c.getState();
        expect(state.expectedTasks).toEqual(['T1', 'T2']);
        const audit = await c.getAudit({ limit: 20 });
        const warn = audit.find((e: any) => e.decision === 'task_count_mismatch' && e.reasoning?.includes('match-change'));
        // may be no warn for matching (or warn with 0 diff not emitted)
        expect(warn).toBeUndefined();
    });
});

describe('harden-task-integrity: completeTask unified hard gate', () => {
    it('INLINE non-newFile without validate -> BLOCK', async () => {
        const statePath = join(tmp, '.opencode', 'ostacky-state.json');
        mkdirSync(join(tmp, '.opencode'), { recursive: true });
        // create a file that exists
        const projFile = join(tmp, 'src', 'auth.ts');
        mkdirSync(join(tmp, 'src'), { recursive: true });
        writeFileSync(projFile, 'foo', 'utf-8');
        const c = new OstackyController({ statePath, initialState: { state: 'EXECUTING_INLINE', executionMode: 'INLINE', tasks: {}, fileFingerprints: { [projFile]: 'old' } } as any });
        // Ensure state is EXECUTING_INLINE
        const s0: any = await c.getState();
        // force state to EXECUTING_INLINE via internal? Use setExpected then consume?
        // Instead directly set via internal by using initialState and then call completeTask
        // Need to ensure load uses that state - we set via constructor initialState
        const res = await c.completeTask({ taskId: '1.1', filePath: projFile });
        expect(res.error).toMatch(/validate required/);
        expect(res.outcome).toBe('CONFLICT');
    });

    it('SUBAGENTS non-newFile without validate -> BLOCK (was WARN)', async () => {
        const statePath = join(tmp, '.opencode', 'ostacky-state.json');
        mkdirSync(join(tmp, '.opencode'), { recursive: true });
        const projFile = join(tmp, 'src', 'auth2.ts');
        mkdirSync(join(tmp, 'src'), { recursive: true });
        writeFileSync(projFile, 'bar', 'utf-8');
        const c = new OstackyController({ statePath, initialState: { state: 'EXECUTING_SUBAGENTS', executionMode: 'SUBAGENT_DRIVEN', tasks: {}, fileFingerprints: { [projFile]: 'x' } } as any });
        const res = await c.completeTask({ taskId: '2.1', filePath: projFile });
        expect(res.error).toBeDefined();
        expect(res.error).toMatch(/validate required/);
        expect(res.outcome).toBe('CONFLICT');
    });

    it('new file without validate -> WARN but COMPLETED', async () => {
        const statePath = join(tmp, '.opencode', 'ostacky-state.json');
        mkdirSync(join(tmp, '.opencode'), { recursive: true });
        mkdirSync(join(tmp, 'src'), { recursive: true });
        const newFile = join(tmp, 'src', 'new-feature.ts');
        // ensure file does NOT exist and not in fingerprints/tasks
        const c = new OstackyController({ statePath, initialState: { state: 'EXECUTING_INLINE', executionMode: 'INLINE', tasks: {}, fileFingerprints: {} } as any });
        // create file now to have fingerprint
        writeFileSync(newFile, 'new content', 'utf-8');
        const res = await c.completeTask({ taskId: 'new1', filePath: newFile });
        // should succeed (new file eximido) with WARN audit
        expect(res.status).toBe('COMPLETED');
        const audit = await c.getAudit({ limit: 10 });
        const warn = audit.find((e: any) => e.decision === 'complete_without_validate');
        expect(warn).toBeDefined();
    });

    it('INLINE with validate -> COMPLETED', async () => {
        const statePath = join(tmp, '.opencode', 'ostacky-state.json');
        mkdirSync(join(tmp, '.opencode'), { recursive: true });
        const projFile = join(tmp, 'src', 'valid.ts');
        mkdirSync(join(tmp, 'src'), { recursive: true });
        writeFileSync(projFile, 'content foo', 'utf-8');
        const c = new OstackyController({ statePath, initialState: { state: 'EXECUTING_INLINE', executionMode: 'INLINE', tasks: {}, fileFingerprints: {} } as any });
        // need to call validateEdit first to set lastValidated
        const content = readFileSync(projFile, 'utf-8');
        const v = await c.validateEdit({ filePath: projFile, oldString: 'foo', newString: 'bar', content });
        expect(v.outcome).toBe('EDITABLE');
        // simulate edit
        writeFileSync(projFile, content.replace('foo', 'bar'), 'utf-8');
        const res = await c.completeTask({ taskId: 'T1', filePath: projFile });
        expect(res.status).toBe('COMPLETED');
    });
});
