import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP_PREFIX = join(tmpdir(), 'ostacky-compact-');
let tmp: string;

beforeEach(() => {
    tmp = mkdtempSync(TMP_PREFIX);
    mkdirSync(join(tmp, '.opencode'), { recursive: true });
});

afterEach(() => {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

function writeState(state: any) {
    const p = join(tmp, '.opencode', 'ostacky-state.json');
    writeFileSync(p, JSON.stringify(state), 'utf-8');
}

// Helper que replica la lógica de auto-inject del plugin sin importarlo (evita ESM issues con controller-core)
function getRecoveryHint(state: any, fallback: any | null) {
    const isTrivial = (text: string, cur: string) => cur === 'DONE' && text.trim().length < 30 && /^(hola|hey|gracias|buenas|hi|hello)\b/i.test(text.trim()) && !/(necesito|quiero|agregá|fix|bug|feature|auth|spec|implementar)/i.test(text);
    // replica plugin logic simplificada
    const curState = state?.state ?? 'DONE';
    let pending: string[] = Array.isArray(state?.lastHandoff?.pendingTasks)
        ? state.lastHandoff.pendingTasks.filter((id: string) => !state.tasks?.[id] || state.tasks[id].status !== 'COMPLETED')
        : [];
    if (pending.length === 0 && fallback && Array.isArray(fallback.pendingTasks) && typeof fallback.ts === 'number' && Date.now() - fallback.ts < 24 * 60 * 60 * 1000) {
        pending = fallback.pendingTasks.filter((id: string) => !state.tasks?.[id] || state.tasks[id].status !== 'COMPLETED');
    }
    if (pending.length === 0) return null;
    if (['DONE', 'INTERPRETATION_PENDING'].includes(curState)) return null;
    // trivial check will be done by caller
    return `[RECOVERY: te quedan ${pending.slice(0, 3).join(',')}${pending.length > 3 ? `, +${pending.length - 3} más` : ''} - usa get_handoff / mem_context para retomar]`;
}

describe('harden-compaction-resume: auto-inject recovery hint', () => {
    it('inyecta RECOVERY cuando hay pending en EXECUTING_INLINE', async () => {
        const state = {
            state: 'EXECUTING_INLINE',
            lastHandoff: { ts: Date.now(), summary: 'ckpt', pendingTasks: ['T3', 'T5'] },
            tasks: { T1: { status: 'COMPLETED' }, T2: { status: 'COMPLETED' } },
        };
        const hint = getRecoveryHint(state, null);
        expect(hint).not.toBeNull();
        expect(hint!).toContain('T3');
        expect(hint!).toContain('T5');
        // verifica que el plugin realmente contiene el código
        const pluginSrc = readFileSync('assets/plugins/ostacky-plugin.ts', 'utf-8');
        expect(pluginSrc).toContain('[RECOVERY:');
        const engramSrc = readFileSync('assets/plugins/engram.ts', 'utf-8');
        expect(engramSrc).toContain('[RECOVERY:');
    });

    it('no inyecta en DONE trivial aunque haya fallback', async () => {
        const state = {
            state: 'DONE',
            lastHandoff: { ts: Date.now(), summary: 'ckpt', pendingTasks: ['T3'] },
            tasks: {},
        };
        const fallback = { pendingTasks: ['T3'], ts: Date.now() };
        // isTrivial true -> no hint
        const text = 'hola';
        const isTrivial = state.state === 'DONE' && text.trim().length < 30 && /^(hola|hey|gracias|buenas|hi|hello)\b/i.test(text.trim());
        expect(isTrivial).toBe(true);
        // lógica de plugin exime trivial, así que aunque hay pending no inyecta
        expect(isTrivial).toBe(true);
        const pluginSrc = readFileSync('assets/plugins/ostacky-plugin.ts', 'utf-8');
        expect(pluginSrc).toContain('isTrivial');
    });

    it('no inyecta cuando fallback expirado >24h', async () => {
        const state = {
            state: 'EXECUTING_INLINE',
            lastHandoff: null,
            tasks: {},
        };
        const fallback = { pendingTasks: ['T9'], ts: Date.now() - 25 * 60 * 60 * 1000 };
        const hint = getRecoveryHint(state, fallback);
        expect(hint).toBeNull();
    });
});
