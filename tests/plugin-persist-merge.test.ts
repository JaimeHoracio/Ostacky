import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergePluginOwnedState, persistState } from '../assets/plugins/ostacky-controller/index.ts';

/**
 * El MCP es la AUTORIDAD del estado; el plugin solo escribe un puñado de campos
 * "advisory". Antes hacía readState → mutar → write del snapshot COMPLETO, así
 * que un avance del MCP en el medio (transición/audit/tasks) se perdía.
 *
 * Ahora: lock compartido + re-lectura fresca dentro del lock + merge selectivo.
 * Estos tests fijan esa garantía.
 */

let root = '';
let statePath = '';

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ostacky-plugin-persist-'));
    mkdirSync(join(root, '.opencode'), { recursive: true });
    statePath = join(root, '.opencode', 'ostacky-state.json');
    process.env.OSTACKY_STATE_PATH = statePath;
});

afterEach(() => {
    delete process.env.OSTACKY_STATE_PATH;
    rmSync(root, { recursive: true, force: true });
});

const readDisk = () => JSON.parse(readFileSync(statePath, 'utf-8'));
const writeDisk = (s: unknown) => writeFileSync(statePath, JSON.stringify(s, null, 2), 'utf-8');

describe('plugin persistState — merge selectivo (no puede pisar al MCP)', () => {
    it('merge puro: parte del disco fresco y aplica SOLO las claves propias', () => {
        const pluginSnapshot = {
            revision: 10,
            state: 'EXECUTING_INLINE',
            tasks: {},
            lastValidated: { byFile: { 'a.ts': { hash: 'h1' } } },
        };
        const fresh = {
            revision: 11,
            state: 'DONE',
            tasks: { T1: { status: 'COMPLETED' } },
            audit: [{ id: 'aud-1' }],
            lastValidated: null,
        };
        const out = mergePluginOwnedState(fresh, pluginSnapshot, ['lastValidated']);
        // lo del MCP sobrevive intacto
        expect(out.revision).toBe(11);
        expect(out.state).toBe('DONE');
        expect(out.tasks).toEqual({ T1: { status: 'COMPLETED' } });
        expect(out.audit).toEqual([{ id: 'aud-1' }]);
        // y se aplica lo del plugin
        expect(out.lastValidated).toEqual({ byFile: { 'a.ts': { hash: 'h1' } } });
    });

    it('sin claves propias declaradas no puede tocar nada del disco', () => {
        const fresh = { revision: 5, state: 'DISCOVERY', tasks: { X: 1 } };
        const stale = { revision: 4, state: 'INTERPRETATION_PENDING', tasks: {}, lastValidated: { byFile: { x: 1 } } };
        expect(mergePluginOwnedState(fresh, stale, [])).toEqual(fresh);
    });

    it('una clave propia ausente en el snapshot no se inyecta', () => {
        const out = mergePluginOwnedState({ revision: 5, lastHeartbeat: 1 }, { revision: 5 }, ['lastHeartbeat']);
        expect(out.lastHeartbeat).toBe(1);
        expect(out.revision).toBe(5);
    });

    it('persistState end-to-end: un avance del MCP en disco sobrevive a la escritura del plugin', () => {
        // El MCP ya avanzó en disco...
        writeDisk({
            revision: 42,
            state: 'EXECUTING_INLINE',
            tasks: { T1: { status: 'COMPLETED' } },
            audit: [{ id: 'aud-mcp' }],
            lastValidated: null,
        });
        // ...y el plugin escribe con un snapshot VIEJO (leído antes del avance)
        const stale = { revision: 41, state: 'INTERPRETATION_PENDING', tasks: {}, lastValidated: { byFile: { 'a.ts': { hash: 'h1' } } } };
        persistState(root, stale, ['lastValidated']);

        const disk = readDisk();
        expect(disk.revision).toBe(42);
        expect(disk.state).toBe('EXECUTING_INLINE');
        expect(disk.tasks).toEqual({ T1: { status: 'COMPLETED' } });
        expect(disk.audit).toEqual([{ id: 'aud-mcp' }]);
        expect(disk.lastValidated).toEqual({ byFile: { 'a.ts': { hash: 'h1' } } });
    });

    it('persistState libera el lock y no deja tmp huérfanos', () => {
        writeDisk({ revision: 1, state: 'DISCOVERY' });
        persistState(root, { revision: 1, lastHeartbeat: 123 }, ['lastHeartbeat']);

        const files = readdirSync(join(root, '.opencode'));
        expect(files.filter((f) => f.includes('.lock'))).toEqual([]);
        expect(files.filter((f) => f.includes('.tmp.'))).toEqual([]);
        expect(readDisk().lastHeartbeat).toBe(123);
    });

    it('con un lock VIVO de otro proceso no lo roba, y aun así no pisa los campos del MCP', () => {
        writeDisk({ revision: 7, state: 'DISCOVERY', tasks: { T9: { status: 'COMPLETED' } }, lastValidated: null });
        const lockPid = statePath + '.lock.pid';
        const lockTs = statePath + '.lock.timestamp';
        // lock tomado por NOSOTROS (pid vivo) y fresco → el plugin no debe liberarlo
        writeFileSync(lockPid, String(process.pid), 'utf-8');
        writeFileSync(lockTs, String(Date.now()), 'utf-8');

        persistState(root, { revision: 6, state: 'INTERPRETATION_PENDING', tasks: {}, lastValidated: { byFile: { 'z.ts': { hash: 'hz' } } } }, [
            'lastValidated',
        ]);

        // no robamos el lock ajeno
        expect(existsSync(lockPid)).toBe(true);
        // el merge igual protege los campos del MCP
        const disk = readDisk();
        expect(disk.revision).toBe(7);
        expect(disk.state).toBe('DISCOVERY');
        expect(disk.tasks).toEqual({ T9: { status: 'COMPLETED' } });
        expect(disk.lastValidated).toEqual({ byFile: { 'z.ts': { hash: 'hz' } } });
    });
});
