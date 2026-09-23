import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uninstallStackConfig } from '../src/stack.js';

const ROOT = join(import.meta.dir, '..');
const PLUGINS = join(ROOT, 'assets', 'plugins');
const PACKAGE = join(PLUGINS, 'ostacky-controller');

describe('plugin-packaging-v2 (TDD RED)', () => {
    it('no deja helpers sueltos sin default en top-level de assets/plugins/', () => {
        const top = readdirSync(PLUGINS, { withFileTypes: true })
            .filter((e) => e.isFile() && e.name.endsWith('.ts'))
            .map((e) => e.name);
        const offenders = top.filter((f) => {
            const src = readFileSync(join(PLUGINS, f), 'utf-8');
            return !src.includes('export default');
        });
        expect(offenders).toEqual([]);
    });

    it('controller-core usa import .js (dual-runtime: loader mapea .js→.ts, Node MCP exige .js literal)', () => {
        // Evidencia server-log: con .js los imports relativos resolvieron (fallaba
        // solo @opencode/plugin con Die); con .ts el mirror MCP muere en Node
        // (Cannot find module security.ts). No cambiar a .ts.
        const src = readFileSync(join(ROOT, 'src', 'controller-core.ts'), 'utf-8');
        expect(src).toContain('./security.js');
        const mcpMirror = readFileSync(join(ROOT, 'assets', 'mcp', 'ostacky-controller', 'controller-core.js'), 'utf-8');
        expect(mcpMirror).toContain('./security.js');
        expect(mcpMirror).not.toContain('./security.ts');
    });

    it('expone package dir ostacky-controller/index.ts con id ostacky-controller', () => {
        const index = join(PACKAGE, 'index.ts');
        expect(existsSync(index)).toBe(true);
        const src = readFileSync(index, 'utf-8');
        expect(src).toContain('ostacky-controller');
        expect(src).toContain('export default');
    });
});

describe('uninstallStackConfig (2.2)', () => {
    it('borra package dir + sueltos legacy y conserva plugins custom', () => {
        const root = mkdtempSync(join(tmpdir(), 'ostacky-uninstall-'));
        try {
            const plugins = join(root, '.opencode', 'plugins');
            mkdirSync(join(plugins, 'ostacky-controller'), { recursive: true });
            writeFileSync(join(plugins, 'ostacky-controller', 'index.ts'), 'x', 'utf-8');
            for (const f of ['ostacky-plugin.ts', 'controller-core.ts', 'security.ts', 'tiered.ts', 'engram.ts', 'custom.ts']) {
                writeFileSync(join(plugins, f), 'x', 'utf-8');
            }
            const paths = {
                root: join(root, '.opencode'),
                agents: '', commands: '', plugins,
                skills: '', mcp: '', tools: join(root, '.opencode', 'tools'),
            };
            const res = uninstallStackConfig(paths);
            expect(res.success).toBe(true);
            expect(existsSync(join(plugins, 'ostacky-controller'))).toBe(false);
            for (const f of ['ostacky-plugin.ts', 'controller-core.ts', 'security.ts', 'tiered.ts', 'engram.ts']) {
                expect(existsSync(join(plugins, f))).toBe(false);
            }
            expect(existsSync(join(plugins, 'custom.ts'))).toBe(true);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
