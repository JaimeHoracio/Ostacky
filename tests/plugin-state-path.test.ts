import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getStatePath, projectStateForTool } from '../assets/plugins/ostacky-controller/index.ts';

/**
 * El MCP puede estar declarado en el opencode.json GLOBAL. Si el plugin resuelve
 * el state path mirando solo el proyecto, lee/escribe OTRO archivo y todos los
 * gates (PENDING, ownership, lastValidated) quedan ciegos: el agente pregunta,
 * el usuario responde, y el gate nunca ve la decisión.
 */

let root = '';
let prevXdg: string | undefined;
let prevStatePath: string | undefined;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ostacky-state-path-'));
    prevXdg = process.env.XDG_CONFIG_HOME;
    prevStatePath = process.env.OSTACKY_STATE_PATH;
    delete process.env.OSTACKY_STATE_PATH;
});

afterEach(() => {
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevXdg;
    if (prevStatePath !== undefined) process.env.OSTACKY_STATE_PATH = prevStatePath;
    rmSync(root, { recursive: true, force: true });
});

function writeGlobalConfig(cfg: unknown): void {
    const xdg = join(root, 'xdg');
    mkdirSync(join(xdg, 'opencode'), { recursive: true });
    writeFileSync(join(xdg, 'opencode', 'opencode.json'), JSON.stringify(cfg), 'utf-8');
    process.env.XDG_CONFIG_HOME = xdg;
}

describe('plugin getStatePath', () => {
    it('usa el OSTACKY_STATE_PATH del opencode.json GLOBAL si el MCP vive ahí', () => {
        writeGlobalConfig({
            mcp: {
                servers: {
                    'ostacky-controller': { environment: { OSTACKY_STATE_PATH: '/custom/state.json' } },
                },
            },
        });
        expect(getStatePath(root)).toBe('/custom/state.json');
    });

    it('cae al .opencode/ostacky-state.json del proyecto si nadie lo configura', () => {
        writeGlobalConfig({ mcp: { servers: {} } });
        expect(getStatePath(root)).toBe(join(root, '.opencode', 'ostacky-state.json'));
    });

    it('el opencode.json del proyecto gana sobre el global', () => {
        writeGlobalConfig({
            mcp: { servers: { 'ostacky-controller': { environment: { OSTACKY_STATE_PATH: '/global/state.json' } } } },
        });
        writeFileSync(
            join(root, 'opencode.json'),
            JSON.stringify({ mcp: { servers: { 'ostacky-controller': { environment: { OSTACKY_STATE_PATH: '/local/state.json' } } } } }),
            'utf-8'
        );
        expect(getStatePath(root)).toBe('/local/state.json');
    });
});

describe('plugin ostacky_get_state', () => {
    it('expone los decision IDs para poder consumir sin volver a pedir el state', () => {
        const out = projectStateForTool({
            state: 'ROUTE_DECISION_PENDING',
            revision: 12,
            requestId: 'req-1',
            routeDecisionId: 'route-1',
            executionDecisionId: null,
            routeChoice: null,
            level: '0+1',
        });
        expect(out.routeDecisionId).toBe('route-1');
        expect(out.state).toBe('ROUTE_DECISION_PENDING');
        expect(out.executionDecisionId).toBe(null);
        expect(out.level).toBe('0+1');
    });

    it('sin state devuelve UNKNOWN en vez de romper', () => {
        expect(projectStateForTool(null)).toMatchObject({ state: 'UNKNOWN', revision: 0 });
    });
});
