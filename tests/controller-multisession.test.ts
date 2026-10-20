import { afterEach, describe, expect, it } from 'bun:test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Integración multi-sesión: dos procesos MCP distintos (como dos ventanas de
 * OpenCode) compartiendo el MISMO state file, cada uno mandando su
 * `_meta["ai.opencode/sessionID"]` — igual que lo hace OpenCode.
 *
 * Cubre:
 *  - K1: el sessionId se extrae de `_meta` (sin esto no hay ownership posible).
 *  - K2: re-lectura fresca por tool call + lock reentrante (sin lost updates).
 *  - K4: guard de ownership con takeover explícito (`force: true`).
 *  - C:  al cerrar las sesiones no queda basura (tmp/lock) y los backups son acotados.
 */

const MCP = join(import.meta.dir, '..', 'assets', 'mcp', 'ostacky-controller', 'index.js');

class McpClient {
    private child: ChildProcessWithoutNullStreams;
    private buf = '';
    private nextId = 1;
    private pending = new Map<number, (msg: any) => void>();

    constructor(
        private statePath: string,
        cwd: string
    ) {
        this.child = spawn(process.execPath, [MCP], {
            cwd,
            env: { ...process.env, OSTACKY_STATE_PATH: statePath },
            stdio: ['pipe', 'pipe', 'pipe'],
        }) as ChildProcessWithoutNullStreams;
        this.child.stdout.on('data', (chunk) => {
            this.buf += chunk.toString();
            const lines = this.buf.split(/\r?\n/);
            this.buf = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.trim()) continue;
                let msg: any;
                try {
                    msg = JSON.parse(line);
                } catch {
                    continue;
                }
                const resolve = typeof msg.id === 'number' ? this.pending.get(msg.id) : undefined;
                if (resolve) {
                    this.pending.delete(msg.id);
                    resolve(msg);
                }
            }
        });
        // Nunca dejar un proceso colgado por stderr lleno
        this.child.stderr.on('data', () => {});
    }

    private request(method: string, params: unknown): Promise<any> {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`timeout esperando ${method}`));
            }, 15_000);
            this.pending.set(id, (msg) => {
                clearTimeout(timer);
                resolve(msg);
            });
            this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        });
    }

    private notify(method: string): void {
        this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
    }

    async init(): Promise<void> {
        await this.request('initialize', {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'ostacky-test', version: '0' },
        });
        this.notify('notifications/initialized');
    }

    /** tools/call con `_meta` (así lo emite OpenCode). */
    async call(name: string, args: Record<string, unknown>, sessionId: string): Promise<any> {
        const msg = await this.request('tools/call', {
            name,
            arguments: args,
            _meta: { 'ai.opencode/sessionID': sessionId },
        });
        const text = msg?.result?.content?.[0]?.text;
        if (text) {
            try {
                return JSON.parse(text);
            } catch {
                return text;
            }
        }
        return msg?.result;
    }

    async stop(): Promise<void> {
        try {
            this.child.stdin.end();
        } catch {}
        this.child.kill();
        await new Promise((r) => setTimeout(r, 400));
    }
}

const bases: string[] = [];

function newProject(): { root: string; statePath: string } {
    const root = mkdtempSync(join(tmpdir(), 'ostacky-ms-'));
    bases.push(root);
    mkdirSync(join(root, '.opencode'), { recursive: true });
    return { root, statePath: join(root, '.opencode', 'ostacky-state.json') };
}

afterEach(() => {
    while (bases.length) rmSync(bases.pop()!, { recursive: true, force: true });
});

describe('controller multi-sesión (integración)', () => {
    it('sesión B no pisa la request activa de A; force:true hace takeover auditado', async () => {
        const { root, statePath } = newProject();
        const a = new McpClient(statePath, root);
        const b = new McpClient(statePath, root);
        try {
            await a.init();
            await b.init();

            // A arranca trabajo
            const aStart = await a.call('start_request', { requestId: 'req-A' }, 'sess-A');
            expect(aStart.conflict).toBeUndefined();
            expect(aStart.ownerSessionId).toBe('sess-A');
            expect(aStart.requestId).toBe('req-A');

            // B NO pisa: recibe conflicto con el estado REAL (de A)
            const bStart = await b.call('start_request', { requestId: 'req-B' }, 'sess-B');
            expect(bStart.conflict).toBe(true);
            expect(bStart.ownerSessionId).toBe('sess-A');
            expect(bStart.requestId).toBe('req-A');

            // en disco sigue ganando A
            const disk1 = JSON.parse(readFileSync(statePath, 'utf-8'));
            expect(disk1.ownerSessionId).toBe('sess-A');
            expect(disk1.requestId).toBe('req-A');

            // B hace takeover explícito
            const bForce = await b.call('start_request', { requestId: 'req-B', force: true }, 'sess-B');
            expect(bForce.conflict).toBeUndefined();
            expect(bForce.ownerSessionId).toBe('sess-B');
            expect(bForce.requestId).toBe('req-B');

            const disk2 = JSON.parse(readFileSync(statePath, 'utf-8'));
            expect(disk2.ownerSessionId).toBe('sess-B');
            expect(disk2.requestId).toBe('req-B');

            // el takeover quedó auditado
            const audit = readFileSync(join(root, '.opencode', 'ostacky-audit.jsonl'), 'utf-8');
            expect(audit).toContain('session_takeover');
        } finally {
            await b.stop();
            await a.stop();
        }
    }, 60_000);

    it('reloadFresh: B ve el estado de A recién escrito (sin snapshot congelado) + callerSessionId', async () => {
        const { root, statePath } = newProject();
        const a = new McpClient(statePath, root);
        const b = new McpClient(statePath, root);
        try {
            await a.init();
            await b.init();

            // B lee PRIMERO (carga el state vacío y lo congelaría con el cache viejo)
            const before = await b.call('get_state', {}, 'sess-B');
            expect(before.requestId ?? null).toBeNull();

            // A escribe
            await a.call('start_request', { requestId: 'req-A' }, 'sess-A');

            // B vuelve a leer: DEBE ver lo de A (esto es lo que rompía el cache #loaded)
            const after = await b.call('get_state', {}, 'sess-B');
            expect(after.requestId).toBe('req-A');
            expect(after.ownerSessionId).toBe('sess-A');
            // K1: el sessionId del caller se expone (prueba de que _meta llegó)
            expect(after.callerSessionId).toBe('sess-B');
        } finally {
            await b.stop();
            await a.stop();
        }
    }, 60_000);

    it('B no puede consumir, refrescar, bloquear ni abandonar la decisión de ejecución de A', async () => {
        const { root, statePath } = newProject();
        const a = new McpClient(statePath, root);
        const b = new McpClient(statePath, root);
        try {
            await a.init();
            await b.init();

            await a.call('start_request', { requestId: 'req-A' }, 'sess-A');
            const disc = await a.call(
                'record_discovery',
                { level: '0+1', snapshot: { symbols: [{ name: 'x' }], files: ['a.ts'], estLines: 5 } },
                'sess-A'
            );
            await a.call('consume_route_decision', { decisionId: disc.routeDecisionId, choice: 'DIRECT' }, 'sess-A');
            const exec = await a.call(
                'record_execution_analysis',
                {
                    snapshot: {
                        codegraphUsed: ['a'],
                        recommendation: 'INLINE',
                        reasons: ['single file'],
                        reasoning: { files: ['a.ts'], estLines: 5 },
                        taskCount: 1,
                        expectedTaskIds: ['T1'],
                    },
                },
                'sess-A'
            );
            expect(exec.state).toBe('EXECUTION_DECISION_PENDING');

            // B no puede tocar la decisión pendiente de A
            expect(
                (await b.call('consume_execution_decision', { decisionId: exec.executionDecisionId, mode: 'INLINE' }, 'sess-B'))
                    .error
            ).toContain('otra sesión');
            expect((await b.call('refresh_decision', {}, 'sess-B')).error).toContain('otra sesión');
            expect((await b.call('block', { reason: 'nope' }, 'sess-B')).error).toContain('otra sesión');
            expect((await b.call('abandon', { reason: 'nope' }, 'sess-B')).error).toContain('otra sesión');
            expect((await b.call('complete_task', { taskId: 'T1' }, 'sess-B')).error).toContain('otra sesión');

            // la decisión de A sigue viva: A la consume sin problemas
            const aConsume = await a.call(
                'consume_execution_decision',
                { decisionId: exec.executionDecisionId, mode: 'INLINE' },
                'sess-A'
            );
            expect(aConsume.state).toBe('EXECUTING_INLINE');
        } finally {
            await b.stop();
            await a.stop();
        }
    }, 60_000);

    it('B no puede consumir la decisión de ruta de A y A conserva la suya', async () => {
        const { root, statePath } = newProject();
        const a = new McpClient(statePath, root);
        const b = new McpClient(statePath, root);
        try {
            await a.init();
            await b.init();

            await a.call('start_request', { requestId: 'req-A' }, 'sess-A');
            const disc = await a.call(
                'record_discovery',
                { level: '0+1', snapshot: { symbols: [{ name: 'x' }], files: ['a.ts'], estLines: 5 } },
                'sess-A'
            );
            expect(disc.state).toBe('ROUTE_DECISION_PENDING');

            const bRoute = await b.call(
                'consume_route_decision',
                { decisionId: disc.routeDecisionId, choice: 'DIRECT' },
                'sess-B'
            );
            expect(bRoute.error).toContain('otra sesión');

            const aRoute = await a.call(
                'consume_route_decision',
                { decisionId: disc.routeDecisionId, choice: 'DIRECT' },
                'sess-A'
            );
            expect(aRoute.state).toBe('EXECUTION_ANALYSIS');
        } finally {
            await b.stop();
            await a.stop();
        }
    }, 60_000);

    it('al cerrar las sesiones no queda basura: sin .tmp/.lock y backups acotados', async () => {
        const { root, statePath } = newProject();
        const dir = join(root, '.opencode');
        const a = new McpClient(statePath, root);
        const b = new McpClient(statePath, root);
        try {
            await a.init();
            await b.init();
            for (let i = 0; i < 5; i++) {
                await a.call('start_request', { requestId: `req-${i}`, force: true }, 'sess-A');
                await b.call('get_state', {}, 'sess-B');
            }
        } finally {
            await b.stop();
            await a.stop();
        }

        const leftovers = readdirSync(dir);
        // 1) nada de temporales ni locks huérfanos
        expect(leftovers.filter((f) => f.includes('.tmp.'))).toEqual([]);
        expect(leftovers.filter((f) => f.includes('.lock'))).toEqual([]);
        // 2) backups ACOTADOS (rotación de 3 niveles, nunca crecen sin límite)
        const backups = leftovers.filter((f) => f.startsWith('ostacky-state.json.backup'));
        expect(backups.length).toBeLessThanOrEqual(3);
        // 3) el state es UN archivo (nada por sesión)
        expect(leftovers.filter((f) => f.includes('sess-A') || f.includes('sess-B'))).toEqual([]);
        expect(leftovers).toContain('ostacky-state.json');
    }, 60_000);
});
