import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OstackyController } from '../assets/mcp/ostacky-controller/index.js';

const TMP_PREFIX = join(tmpdir(), 'ostacky-create-');
let tmp: string;

beforeEach(() => {
    tmp = mkdtempSync(TMP_PREFIX);
    mkdirSync(join(tmp, '.opencode'), { recursive: true });
    mkdirSync(join(tmp, 'src'), { recursive: true });
});

afterEach(() => {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

function ctrl(extra: any = {}) {
    const statePath = join(tmp, '.opencode', 'ostacky-state.json');
    return new OstackyController({
        statePath,
        initialState: { state: 'EXECUTING_INLINE', executionMode: 'INLINE', tasks: {}, fileFingerprints: {}, ...extra } as any,
    });
}

describe('fix-new-file-gate: modo create en validateEdit', () => {
    it('create sobre archivo inexistente -> EDITABLE y complete sin WARN', async () => {
        const c = ctrl();
        const newFile = join(tmp, 'src', 'nuevo.ts');
        const v = await c.validateEdit({ filePath: newFile, oldString: '', newString: 'export const x = 1;', content: '' });
        expect(v.outcome).toBe('EDITABLE');
        writeFileSync(newFile, 'export const x = 1;', 'utf-8');
        const res = await c.completeTask({ taskId: 'c1', filePath: newFile });
        expect(res.status).toBe('COMPLETED');
        const audit = await c.getAudit({ limit: 10 });
        const warn = audit.find((e: any) => e.decision === 'complete_without_validate' && JSON.stringify(e).includes('nuevo.ts'));
        expect(warn).toBeUndefined();
    });

    it('create sobre archivo existente -> CONFLICT file exists', async () => {
        const c = ctrl();
        const existing = join(tmp, 'src', 'existe.ts');
        writeFileSync(existing, 'algo', 'utf-8');
        const v = await c.validateEdit({ filePath: existing, oldString: '', newString: 'otro', content: '' });
        expect(v.outcome).toBe('CONFLICT');
        expect(v.reason).toMatch(/file exists/);
    });

    it('create con newString vacio -> CONFLICT', async () => {
        const c = ctrl();
        const newFile = join(tmp, 'src', 'vacio.ts');
        const v = await c.validateEdit({ filePath: newFile, oldString: '', newString: '', content: '' });
        expect(v.outcome).toBe('CONFLICT');
        expect(v.reason).toMatch(/newString required/);
    });
});

describe('fix-new-file-gate: ligadura por-archivo (sin invalidacion cruzada)', () => {
    it('validar A(create) + B(replace) y completar en inverso -> ambos COMPLETED', async () => {
        const c = ctrl();
        const fileA = join(tmp, 'src', 'a-nuevo.ts');
        const fileB = join(tmp, 'src', 'b-existe.ts');
        writeFileSync(fileB, 'contenido foo', 'utf-8');
        const vA = await c.validateEdit({ filePath: fileA, oldString: '', newString: 'nuevo A', content: '' });
        expect(vA.outcome).toBe('EDITABLE');
        const contentB = readFileSync(fileB, 'utf-8');
        const vB = await c.validateEdit({ filePath: fileB, oldString: 'foo', newString: 'bar', content: contentB });
        expect(vB.outcome).toBe('EDITABLE');
        writeFileSync(fileA, 'nuevo A', 'utf-8');
        writeFileSync(fileB, contentB.replace('foo', 'bar'), 'utf-8');
        // orden inverso: B primero, A después — con slot único A bloquearía
        const resB = await c.completeTask({ taskId: 'tB', filePath: fileB });
        expect(resB.status).toBe('COMPLETED');
        const resA = await c.completeTask({ taskId: 'tA', filePath: fileA });
        expect(resA.status).toBe('COMPLETED');
    });

    it('segundo complete al mismo path sin re-validar -> BLOCK', async () => {
        const c = ctrl();
        const file = join(tmp, 'src', 'uno.ts');
        writeFileSync(file, 'hola mundo', 'utf-8');
        const content = readFileSync(file, 'utf-8');
        const v = await c.validateEdit({ filePath: file, oldString: 'mundo', newString: 'todo', content });
        expect(v.outcome).toBe('EDITABLE');
        writeFileSync(file, content.replace('mundo', 'todo'), 'utf-8');
        const res1 = await c.completeTask({ taskId: 'u1', filePath: file });
        expect(res1.status).toBe('COMPLETED');
        const res2 = await c.completeTask({ taskId: 'u2', filePath: file });
        expect(res2.error).toMatch(/validate required/);
        expect(res2.outcome).toBe('CONFLICT');
    });

    it('fallback legacy: slot antiguo {filePath,hash} sigue consumible', async () => {
        const file = join(tmp, 'src', 'legacy.ts');
        writeFileSync(file, 'abc', 'utf-8');
        const statePath = join(tmp, '.opencode', 'ostacky-state.json');
        const c = new OstackyController({
            statePath,
            initialState: {
                state: 'EXECUTING_INLINE',
                executionMode: 'INLINE',
                tasks: {},
                fileFingerprints: {},
                lastValidated: { filePath: file, hash: 'whatever', ts: Date.now() },
            } as any,
        });
        const res = await c.completeTask({ taskId: 'leg1', filePath: file });
        expect(res.status).toBe('COMPLETED');
    });
});
