import { afterEach, describe, expect, it } from 'bun:test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Integración de session-state-files: dos procesos MCP (dos sesiones de OpenCode) sobre el
 * mismo proyecto. Cada sesión recibe su slot en .opencode/sessions/ y no comparte request.
 */
const MCP = join(import.meta.dir, '..', 'assets', 'mcp', 'ostacky-controller', 'index.js');

class McpClient {
    private child: ChildProcessWithoutNullStreams;
    private buf = '';
    private nextId = 1;
    private pending = new Map<number, (msg: any) => void>();

    constructor(statePath: string, cwd: string) {
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
        await new Promise((r) => setTimeout(r, 300));
    }
}

const clients: McpClient[] = [];
let root = '';

async function setup(): Promise<{ opencodeDir: string; statePath: string }> {
    root = mkdtempSync(join(tmpdir(), 'ostacky-slots-int-'));
    const opencodeDir = join(root, '.opencode');
    mkdirSync(opencodeDir, { recursive: true });
    return { opencodeDir, statePath: join(opencodeDir, 'ostacky-state.json') };
}

async function spawnSession(statePath: string): Promise<McpClient> {
    const c = new McpClient(statePath, root);
    clients.push(c);
    await c.init();
    return c;
}

function readIndex(opencodeDir: string): any {
    return JSON.parse(readFileSync(join(opencodeDir, 'sessions', 'index.json'), 'utf-8'));
}

afterEach(async () => {
    while (clients.length) await clients.pop()!.stop();
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
});

describe('session-state-files — integración MCP (dos sesiones, mismo proyecto)', () => {
    it('cada sesión inicia su request en su propio slot y no hay conflict', async () => {
        const { opencodeDir, statePath } = await setup();
        const a = await spawnSession(statePath);
        const b = await spawnSession(statePath);

        const ra = await a.call('start_request', { requestId: 'req-A', changeId: 'pagos' }, 'sesA');
        const rb = await b.call('start_request', { requestId: 'req-B', changeId: 'login' }, 'sesB');

        expect(ra.conflict).toBeUndefined();
        expect(rb.conflict).toBeUndefined();
        expect(ra.requestId).toBe('req-A');
        expect(rb.requestId).toBe('req-B');

        const idx = readIndex(opencodeDir);
        const bySession = Object.values(idx.slots).filter((s: any) => s.sessionId).map((s: any) => s.sessionId).sort();
        expect(bySession).toEqual(['sesA', 'sesB']);
        expect(idx.slots['pool-01'].requestId).toBe('req-A');
        expect(idx.slots['pool-02'].requestId).toBe('req-B');
    }, 30_000);

    it('B no puede consumir ni mutar la request de A: está en otro slot', async () => {
        const { opencodeDir, statePath } = await setup();
        const a = await spawnSession(statePath);
        const b = await spawnSession(statePath);
        await a.call('start_request', { requestId: 'req-A' }, 'sesA');
        await b.call('start_request', { requestId: 'req-B' }, 'sesB');

        const blocked = await b.call('block', { reason: 'intento de B sobre A' }, 'sesB');
        expect(JSON.stringify(blocked)).not.toContain('req-A');

        const slotA = JSON.parse(readFileSync(join(opencodeDir, 'sessions', 'pool-01.json'), 'utf-8'));
        expect(slotA.requestId).toBe('req-A');
        expect(slotA.state).toBe('INTERPRETATION_PENDING');
    }, 30_000);

    it('sustitución confirmada: la sesión anterior queda BLOCKED en su siguiente tool', async () => {
        const { statePath } = await setup();
        const a = await spawnSession(statePath);
        const b = await spawnSession(statePath);
        await a.call('start_request', { requestId: 'req-A' }, 'sesA');
        const takeover = await b.call('start_request', { requestId: 'req-B', replaceSlot: 'pool-01' }, 'sesB');
        expect(takeover.requestId).toBe('req-B');

        const next = await a.call('get_state', {}, 'sesA');
        expect(String(next.error)).toContain('BLOCKED');
        expect(String(next.error)).toContain('sustituida');
    }, 30_000);

    it('la identidad de sesión se guarda en el índice (heartbeat y lastUsedAt) en cada llamada', async () => {
        const { opencodeDir, statePath } = await setup();
        const a = await spawnSession(statePath);
        await a.call('start_request', { requestId: 'req-A' }, 'sesA');
        const first = readIndex(opencodeDir).slots['pool-01'].ownerHeartbeat;
        await new Promise((r) => setTimeout(r, 20));
        await a.call('get_state', {}, 'sesA');
        const second = readIndex(opencodeDir).slots['pool-01'].ownerHeartbeat;
        expect(second).toBeGreaterThan(first);
    }, 30_000);

    it('no quedan archivos temporales ni locks en sessions/ tras las llamadas', async () => {
        const { opencodeDir, statePath } = await setup();
        const a = await spawnSession(statePath);
        const b = await spawnSession(statePath);
        await Promise.all([
            a.call('start_request', { requestId: 'req-A' }, 'sesA'),
            b.call('start_request', { requestId: 'req-B' }, 'sesB'),
        ]);
        await a.call('get_state', {}, 'sesA');
        const left = readdirSync(join(opencodeDir, 'sessions')).filter((f) => f.includes('.tmp') || f.includes('.lock'));
        expect(left).toEqual([]);
        expect(existsSync(join(opencodeDir, 'sessions', 'pool-01.json'))).toBe(true);
    }, 30_000);

    it('migra el state legado al primer slot y renombra el archivo', async () => {
        const { opencodeDir, statePath } = await setup();
        writeFileSync(statePath, JSON.stringify({ state: 'INTERPRETATION_PENDING', revision: 3, requestId: 'req-legacy' }));
        const a = await spawnSession(statePath);
        const r = await a.call('get_state', {}, 'sesA');
        expect(r.requestId).toBe('req-legacy');
        expect(existsSync(statePath)).toBe(false);
        expect(existsSync(statePath + '.migrated')).toBe(true);
        expect(readIndex(opencodeDir).migrated).toBe(true);
    }, 30_000);
});

describe('handoff de compaction por sesión — integración MCP', () => {
    it('get_handoff devuelve solo el fallback de la propia sesión', async () => {
        const { opencodeDir, statePath } = await setup();
        const { handoffFallbackPath } = await import('../src/session-store.ts');
        writeFileSync(
            handoffFallbackPath(opencodeDir, 'sesA'),
            JSON.stringify({ summary: 'compaction A', pendingTasks: ['T3'], nextSteps: ['T3'], ts: Date.now() })
        );
        const a = await spawnSession(statePath);
        const b = await spawnSession(statePath);

        const ha = await a.call('get_handoff', {}, 'sesA');
        const hb = await b.call('get_handoff', {}, 'sesB');

        expect(JSON.stringify(ha)).toContain('compaction A');
        expect(JSON.stringify(hb)).not.toContain('compaction A');
    });
});
