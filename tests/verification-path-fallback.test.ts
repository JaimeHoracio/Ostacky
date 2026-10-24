import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OstackyController } from '../assets/mcp/ostacky-controller/index.js';

/**
 * Dos drifts del cierre detectados en uso real:
 *
 *  1. `verify_integrity` / `implementation_complete` re-chequeaban los needles
 *     `file:` solo contra `task.filePath`. Una task completada sin ese campo
 *     fallaba aunque el needle estuviera en el archivo que declara la propia
 *     verificación (`file:<path> contiene <str>`).
 *  2. `lastValidated` se escribe con paths absolutos (plugin) y se leía con el
 *     string exacto que manda el agente (relativo) → "validate required" aunque
 *     el validate existiera.
 */

let tmp = '';

beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ostacky-verif-path-'));
});

afterEach(() => {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

function statePath(dir: string): string {
    mkdirSync(join(tmp, dir), { recursive: true });
    return join(tmp, dir, 'ostacky-state.json');
}

function baseState(state: string, extra: any = {}) {
    return {
        state,
        tasks: {},
        expectedTasks: ['T1'],
        expectedTaskCount: 1,
        audit: [],
        auditSeq: 0,
        ...extra,
    } as any;
}

describe('cierre: needle file: sin task.filePath', () => {
    it('verify_integrity resuelve el path declarado en la verificación', async () => {
        const sp = statePath('.opencode-a');
        mkdirSync(join(tmp, 'src'), { recursive: true });
        writeFileSync(join(tmp, 'src', 'a.ts'), 'export const foo = 1;\n', 'utf-8');
        const c = new OstackyController({
            statePath: sp,
            initialState: baseState('EXECUTING_INLINE', {
                tasks: { T1: { status: 'COMPLETED' } },
                taskVerifications: { T1: 'file:src/a.ts contiene export const foo' },
            }),
        });

        const v: any = await c.verifyIntegrity();
        expect(v.verificationFailed).toBeUndefined();
        expect(v.ok).toBe(true);
    });

    it('sigue fallando si el needle no está en el archivo declarado', async () => {
        const sp = statePath('.opencode-b');
        mkdirSync(join(tmp, 'src'), { recursive: true });
        writeFileSync(join(tmp, 'src', 'a.ts'), 'export const bar = 1;\n', 'utf-8');
        const c = new OstackyController({
            statePath: sp,
            initialState: baseState('EXECUTING_INLINE', {
                tasks: { T1: { status: 'COMPLETED' } },
                taskVerifications: { T1: 'file:src/a.ts contiene export const foo' },
            }),
        });

        const v: any = await c.verifyIntegrity();
        expect(v.ok).toBe(false);
        expect(v.verificationFailed?.[0]).toContain('src/a.ts');
    });

    it('implementation_complete no se bloquea por el filePath faltante', async () => {
        const sp = statePath('.opencode-c');
        mkdirSync(join(tmp, 'src'), { recursive: true });
        writeFileSync(join(tmp, 'src', 'a.ts'), 'export const foo = 1;\n', 'utf-8');
        const c = new OstackyController({
            statePath: sp,
            initialState: baseState('EXECUTING_INLINE', {
                tasks: { T1: { status: 'COMPLETED' } },
                taskVerifications: { T1: 'file:src/a.ts contiene export const foo' },
            }),
        });

        const res: any = await c.implementationComplete({});
        expect(res.error).toBeUndefined();
        expect(res.state).toBe('SYNC');
        expect(res.forced).toBeFalsy();
    });
});

describe('lastValidated: path absoluto vs relativo', () => {
    it('complete_task acepta filePath relativo si el validate se guardó absoluto', async () => {
        const sp = statePath('.opencode-d');
        mkdirSync(join(tmp, 'src'), { recursive: true });
        const abs = join(tmp, 'src', 'b.ts');
        writeFileSync(abs, 'export const foo = 1;\n', 'utf-8');
        const c = new OstackyController({
            statePath: sp,
            initialState: baseState('EXECUTING_INLINE', {
                taskVerifications: { T1: 'file:src/b.ts contiene export const foo' },
                lastValidated: {
                    byFile: { [abs]: { hash: null, ts: Date.now(), mode: 'replace' } },
                    filePath: abs,
                    hash: null,
                    ts: Date.now(),
                    mode: 'replace',
                },
            }),
        });

        const res: any = await c.completeTask({ taskId: 'T1', filePath: 'src/b.ts' });
        expect(res.error).toBeUndefined();
        expect(res.status).toBe('COMPLETED');
    });

    it('limpia el validate absoluto al completar con path relativo', async () => {
        const sp = statePath('.opencode-e');
        mkdirSync(join(tmp, 'src'), { recursive: true });
        const abs = join(tmp, 'src', 'c.ts');
        writeFileSync(abs, 'export const foo = 1;\n', 'utf-8');
        const c = new OstackyController({
            statePath: sp,
            initialState: baseState('EXECUTING_INLINE', {
                tasks: {},
                expectedTasks: ['T1', 'T2'],
                expectedTaskCount: 2,
                taskVerifications: { T1: 'file:src/c.ts contiene export const foo' },
                lastValidated: {
                    byFile: { [abs]: { hash: null, ts: Date.now(), mode: 'replace' } },
                    filePath: abs,
                    hash: null,
                    ts: Date.now(),
                    mode: 'replace',
                },
            }),
        });

        await c.completeTask({ taskId: 'T1', filePath: 'src/c.ts' });
        // El validate se consumió: la segunda task del mismo archivo exige uno nuevo.
        const second: any = await c.completeTask({ taskId: 'T2', filePath: 'src/c.ts' });
        expect(second.error).toMatch(/validate required/i);
    });
});
