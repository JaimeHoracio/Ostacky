import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compactionPayload, recoveryHint, recoveryPending } from '../assets/plugins/ostacky-controller/index.ts';

/**
 * El fallback de compaction escribía `pendingTasks: []` hardcodeado, y el hint
 * de recovery solo miraba `lastHandoff` (que el MCP refresca cada 3er
 * complete_task). Resultado: en T1/T2 la compactación perdía el hilo y el hint
 * nunca disparaba. `recoveryPending` es la fuente única de las tres señales.
 */

let root = '';
let prevStatePath: string | undefined;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ostacky-compaction-'));
    prevStatePath = process.env.OSTACKY_STATE_PATH;
    mkdirSync(join(root, '.opencode'), { recursive: true });
    process.env.OSTACKY_STATE_PATH = join(root, '.opencode', 'ostacky-state.json');
});

afterEach(() => {
    if (prevStatePath === undefined) delete process.env.OSTACKY_STATE_PATH;
    else process.env.OSTACKY_STATE_PATH = prevStatePath;
    rmSync(root, { recursive: true, force: true });
});

const fallbackPath = () => join(root, '.opencode', '.ostacky-handoff-compaction.json');

const stateT2of5 = () => ({
    requestId: 'req-1',
    state: 'EXECUTING_INLINE',
    expectedTasks: ['T1', 'T2', 'T3', 'T4', 'T5'],
    tasks: { T1: { status: 'COMPLETED' }, T2: { status: 'COMPLETED' } },
    lastHandoff: null,
});

describe('recoveryPending', () => {
    it('deriva de expectedTasks cuando no hay lastHandoff ni fallback', () => {
        expect(recoveryPending(stateT2of5(), root).pending).toEqual(['T3', 'T4', 'T5']);
    });

    it('el fallback reciente gana sobre expectedTasks', () => {
        writeFileSync(
            fallbackPath(),
            JSON.stringify({ pendingTasks: ['T4'], nextSteps: ['seguir por T4'], ts: Date.now() }),
            'utf-8'
        );
        const { pending, nextSteps } = recoveryPending(stateT2of5(), root);
        expect(pending).toEqual(['T4']);
        expect(nextSteps).toEqual(['seguir por T4']);
    });

    it('ignora el fallback de más de 24h', () => {
        writeFileSync(
            fallbackPath(),
            JSON.stringify({ pendingTasks: ['T4'], ts: Date.now() - 25 * 60 * 60 * 1000 }),
            'utf-8'
        );
        expect(recoveryPending(stateT2of5(), root).pending).toEqual(['T3', 'T4', 'T5']);
    });

    it('lastHandoff gana sobre todo y filtra las tasks completadas', () => {
        const state = { ...stateT2of5(), lastHandoff: { pendingTasks: ['T2', 'T3', 'T5'], nextSteps: ['x'] } };
        expect(recoveryPending(state, root).pending).toEqual(['T3', 'T5']);
    });

    it('sin pendientes no inventa nextSteps', () => {
        const state = { expectedTasks: ['T1'], tasks: { T1: { status: 'COMPLETED' } } };
        expect(recoveryPending(state, root)).toEqual({ pending: [], nextSteps: [] });
    });
});

describe('compactionPayload', () => {
    it('escribe los pendientes reales en vez de []', () => {
        const payload = compactionPayload(stateT2of5(), root, 'ses-1', 'ctx');
        expect(payload.pendingTasks).toEqual(['T3', 'T4', 'T5']);
        expect(payload.nextSteps).toEqual(['Continuar con T3, T4, T5']);
        expect(payload.summary).toContain('req-1');
    });

    it('sin state no rompe y cae al sessionID', () => {
        const payload = compactionPayload(null, root, 'ses-1');
        expect(payload.pendingTasks).toEqual([]);
        expect(payload.summary).toContain('ses-1');
    });
});

describe('recoveryHint', () => {
    it('aparece sin lastHandoff: deriva de expectedTasks', () => {
        const hint = recoveryHint(stateT2of5(), root);
        expect(hint).toContain('RECOVERY');
        expect(hint).toContain('T3');
        expect(hint).toContain('T4');
    });

    it('recorta a 3 ids y cuenta el resto', () => {
        const state = {
            expectedTasks: ['T1', 'T2', 'T3', 'T4', 'T5'],
            tasks: { T1: { status: 'COMPLETED' } },
        };
        const hint = recoveryHint(state, root);
        expect(hint).toContain('+1 más');
    });

    it('es null sin pendientes', () => {
        expect(recoveryHint({ expectedTasks: [], tasks: {} }, root)).toBeNull();
    });

    it('es null en DONE aunque queden tasks sin COMPLETED', () => {
        expect(recoveryHint({ ...stateT2of5(), state: 'DONE' }, root)).toBeNull();
    });
});
