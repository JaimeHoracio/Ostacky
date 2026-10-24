import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDoctorV2, globalOstackyArtifacts, globalPluginScopeAware } from '../src/doctor-v2.ts';

/**
 * Si el usuario tiene Ostacky instalado global Y local, OpenCode V2 dedupea
 * por `id` y conserva la PRIMERA ocurrencia en orden de arranque (el config
 * global se descubre antes): con el mismo id la copia local queda
 * `failed: "Duplicate plugin ID"`. La copia global nueva declara otro id y cede
 * la precedencia; el contrato del doctor es distinguir ambos casos con la ruta
 * concreta, sin tocar el dir global.
 */

let root = '';
let globalDir = '';
let projectRoot = '';
let prevXdg: string | undefined;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ostacky-global-'));
    globalDir = join(root, 'xdg', 'opencode');
    projectRoot = join(root, 'proj');
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(projectRoot, { recursive: true });
    prevXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = join(root, 'xdg');
});

afterEach(() => {
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevXdg;
    rmSync(root, { recursive: true, force: true });
});

describe('globalOstackyArtifacts', () => {
    it('detecta el agente global', () => {
        mkdirSync(join(globalDir, 'agent'), { recursive: true });
        writeFileSync(join(globalDir, 'agent', 'ostacky.md'), 'x', 'utf-8');
        expect(globalOstackyArtifacts(globalDir)).toEqual([join(globalDir, 'agent', 'ostacky.md')]);
    });

    it('detecta el MCP en el opencode.json global', () => {
        writeFileSync(
            join(globalDir, 'opencode.json'),
            JSON.stringify({ mcp: { servers: { 'ostacky-controller': { type: 'local' } } } }),
            'utf-8'
        );
        expect(globalOstackyArtifacts(globalDir)).toEqual([join(globalDir, 'opencode.json')]);
    });

    it('un opencode.json sin Ostacky no cuenta', () => {
        writeFileSync(
            join(globalDir, 'opencode.json'),
            JSON.stringify({ mcp: { servers: { engram: {} } } }),
            'utf-8'
        );
        expect(globalOstackyArtifacts(globalDir)).toEqual([]);
    });

    it('un dir global inexistente no rompe', () => {
        expect(globalOstackyArtifacts(join(root, 'nope'))).toEqual([]);
    });

    it('sin artefactos globales devuelve lista vacía', () => {
        expect(globalOstackyArtifacts(globalDir)).toEqual([]);
    });
});

describe('checkDoctorV2', () => {
    it('reporta la convivencia global/local como warning accionable', () => {
        mkdirSync(join(globalDir, 'agent'), { recursive: true });
        writeFileSync(join(globalDir, 'agent', 'ostacky.md'), 'x', 'utf-8');

        const lines = checkDoctorV2(projectRoot);
        const warning = lines.find((l) => l.includes('Instalación global convive con la local'));
        expect(warning).toBeDefined();
        expect(warning).toContain('uninstall --scope global');
    });

    it('sin artefactos globales no emite el warning', () => {
        const lines = checkDoctorV2(projectRoot);
        expect(lines.some((l) => l.includes('Instalación global convive con la local'))).toBe(false);
    });
});

describe('globalPluginScopeAware', () => {
    it('null cuando no hay plugin Ostacky global', () => {
        expect(globalPluginScopeAware(globalDir)).toBeNull();
    });

    it('false para una copia legacy con id compartido', () => {
        const dir = join(globalDir, 'plugins', 'ostacky-controller');
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'index.ts'),
            'export default {\n  id: "ostacky-controller",\n  async setup() {}\n}\n',
            'utf-8'
        );
        expect(globalPluginScopeAware(globalDir)).toBe(false);
    });

    it('true para una copia que declara el id de scope global', () => {
        const dir = join(globalDir, 'plugin', 'ostacky-controller');
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'index.js'),
            'const PLUGIN_ID = IS_GLOBAL_COPY ? "ostacky-controller-global" : "ostacky-controller"\n',
            'utf-8'
        );
        expect(globalPluginScopeAware(globalDir)).toBe(true);
    });
});

describe('checkDoctorV2 — colisión de plugin por id', () => {
    function writeGlobalPlugin(content: string) {
        const dir = join(globalDir, 'plugins', 'ostacky-controller');
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'index.ts'), content, 'utf-8');
    }

    it('copia legacy: avisa que corre el global y el local queda deshabilitado', () => {
        writeGlobalPlugin('export default {\n  id: "ostacky-controller",\n  async setup() {}\n}\n');
        const lines = checkDoctorV2(projectRoot);
        const warning = lines.find((l) => l.includes('plugin global legacy'));
        expect(warning).toBeDefined();
        expect(warning).toContain('Duplicate plugin ID');
        expect(warning).toContain('uninstall --scope global');
    });

    it('copia con id propio: avisa que el global cede la precedencia', () => {
        writeGlobalPlugin('const PLUGIN_ID = IS_GLOBAL_COPY ? "ostacky-controller-global" : "ostacky-controller"\n');
        const lines = checkDoctorV2(projectRoot);
        const warning = lines.find((l) => l.includes('cede la precedencia al local'));
        expect(warning).toBeDefined();
        expect(lines.some((l) => l.includes('Duplicate plugin ID'))).toBe(false);
    });
});
