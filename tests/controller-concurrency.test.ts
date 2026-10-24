import { afterEach, describe, expect, it } from 'bun:test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serializeOp } from '../assets/mcp/ostacky-controller/index.js';

/**
 * Regresión de `fix-consume-race-lock`.
 *
 * Code Mode emite varias tools en paralelo DENTRO del mismo proceso MCP. El
 * estado es un único objeto en memoria, así que un `get_state` concurrente
 * reemplazaba el snapshot mientras un `consume_*` tenía su transición en vuelo:
 * el persist escribía el estado viejo y el disco quedaba en `*_PENDING`.
 * Síntoma reportado: el agente volvía a preguntar DIRECT/SPEC e INLINE/SUBAGENT.
 *
 * También cubre los locks que no se liberaban: huérfano (pid sin timestamp) y
 * stale de un proceso muerto (`#releaseLock` se negaba a tocar el lock ajeno).
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

    async init(): Promise<void> {
        await this.request('initialize', {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'ostacky-test', version: '0' },
        });
        this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    }

    async call(name: string, args: Record<string, unknown>, sessionId = 'sess-A'): Promise<any> {
        const msg = await this.request('tools/call', {
            name,
            arguments: args,
            _meta: { 'ai.opencode/sessionID': sessionId },
        });
        const text = msg?.result?.content?.[0]?.text;
        if (typeof text === 'string') {
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
        await new Promise((r) => setTimeout(r, 300));
    }
}

const bases: string[] = [];

function newProject(): { root: string; statePath: string } {
    const root = mkdtempSync(join(tmpdir(), 'ostacky-concurrency-'));
    bases.push(root);
    mkdirSync(join(root, '.opencode'), { recursive: true });
    return { root, statePath: join(root, '.opencode', 'ostacky-state.json') };
}

function diskState(statePath: string): string {
    return JSON.parse(readFileSync(statePath, 'utf-8')).state;
}

/** Pid de un proceso que ya terminó (nunca se reusa en la ventana del test). */
async function deadPid(): Promise<number> {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    const pid = child.pid!;
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    return pid;
}

afterEach(() => {
    while (bases.length) rmSync(bases.pop()!, { recursive: true, force: true });
});

describe('controller: consume concurrente no pierde la transición', () => {
    it('consume_route_decision + get_state en el mismo batch deja el disco en EXECUTION_ANALYSIS', async () => {
        const { root, statePath } = newProject();
        const a = new McpClient(statePath, root);
        try {
            await a.init();
            for (let i = 0; i < 3; i++) {
                await a.call('start_request', { requestId: `req-${i}`, force: true });
                const disc = await a.call('record_discovery', {
                    level: '0+1',
                    snapshot: { symbols: [{ name: 'x' }], files: ['a.ts'], estLines: 5 },
                });

                const [consume] = await Promise.all([
                    a.call('consume_route_decision', { decisionId: disc.routeDecisionId, choice: 'DIRECT' }),
                    ...Array.from({ length: 5 }, () => a.call('get_state', {})),
                ]);

                // Antes: `{state:"ROUTE_DECISION_PENDING", routeChoice:"DIRECT"}` y disco en PENDING
                expect(consume.state).toBe('EXECUTION_ANALYSIS');
                expect(diskState(statePath)).toBe('EXECUTION_ANALYSIS');
            }
        } finally {
            await a.stop();
        }
    }, 60_000);
});

describe('controller: serialización in-process', () => {
    it('serializeOp nunca solapa dos operaciones y respeta el orden de llegada', async () => {
        let active = 0;
        let maxActive = 0;
        const order: number[] = [];

        await Promise.all(
            Array.from({ length: 6 }, (_, i) =>
                serializeOp(async () => {
                    active++;
                    maxActive = Math.max(maxActive, active);
                    await new Promise((r) => setTimeout(r, 5));
                    order.push(i);
                    active--;
                })
            )
        );

        expect(maxActive).toBe(1);
        expect(order).toEqual([0, 1, 2, 3, 4, 5]);
    });
});

describe('controller: locks huérfanos y stale', () => {
    it('libera un lock huérfano (pid vivo, sin timestamp) en vez de fallar el consume', async () => {
        const { root, statePath } = newProject();
        const a = new McpClient(statePath, root);
        try {
            await a.init();
            await a.call('start_request', { requestId: 'req-orphan' });
            const disc = await a.call('record_discovery', {
                level: '0+1',
                snapshot: { symbols: [{ name: 'x' }], files: ['a.ts'], estLines: 5 },
            });

            // Lock a medio escribir: pid sin timestamp (crash entre ambos writes).
            writeFileSync(statePath + '.lock.pid', String(process.pid));

            const consume = await a.call('consume_route_decision', {
                decisionId: disc.routeDecisionId,
                choice: 'DIRECT',
            });
            // Antes: `Could not acquire state file lock` tras ~5s, disco en PENDING
            expect(consume.error).toBeUndefined();
            expect(consume.state).toBe('EXECUTION_ANALYSIS');
            expect(diskState(statePath)).toBe('EXECUTION_ANALYSIS');
        } finally {
            try {
                unlinkSync(statePath + '.lock.pid');
            } catch {}
            await a.stop();
        }
    }, 60_000);

    it('libera un lock stale cuyo dueño ya murió', async () => {
        const { root, statePath } = newProject();
        const a = new McpClient(statePath, root);
        try {
            await a.init();
            await a.call('start_request', { requestId: 'req-stale' });
            const disc = await a.call('record_discovery', {
                level: '0+1',
                snapshot: { symbols: [{ name: 'x' }], files: ['a.ts'], estLines: 5 },
            });

            writeFileSync(statePath + '.lock.pid', String(await deadPid()));
            writeFileSync(statePath + '.lock.timestamp', String(Date.now() - 60_000));

            const consume = await a.call('consume_route_decision', {
                decisionId: disc.routeDecisionId,
                choice: 'DIRECT',
            });
            expect(consume.error).toBeUndefined();
            expect(consume.state).toBe('EXECUTION_ANALYSIS');
            expect(diskState(statePath)).toBe('EXECUTION_ANALYSIS');
        } finally {
            await a.stop();
        }
    }, 60_000);
});
