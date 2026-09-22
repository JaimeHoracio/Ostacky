import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkDoctorV2 } from '../src/doctor-v2.js';

const TEST_ROOT = join(import.meta.dir, '.test-doctor-v2-project');

afterEach(() => {
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
});

function writeProject(files: Record<string, string>) {
    mkdirSync(TEST_ROOT, { recursive: true });
    for (const [rel, content] of Object.entries(files)) {
        const full = join(TEST_ROOT, rel);
        mkdirSync(join(full, '..'), { recursive: true });
        writeFileSync(full, content, 'utf-8');
    }
}

describe('checkDoctorV2', () => {
    it('is read-only: never modifies opencode.json', () => {
        const before = JSON.stringify({
            mcp: { codegraph: { type: 'local', command: ['x'], enabled: true } },
            permission: { bash: { 'git push *': 'ask' } },
        });
        writeProject({ 'opencode.json': before });
        checkDoctorV2(TEST_ROOT);
        expect(readFileSync(join(TEST_ROOT, 'opencode.json'), 'utf-8')).toBe(before);
    });

    it('flags a V1 plugin file as legacy instead of active', () => {
        writeProject({
            'opencode.json': '{}',
            '.opencode/plugins/ostacky-plugin.ts': `import type { Plugin } from "@opencode-ai/plugin"\nexport const OstackyController: Plugin = async (ctx) => ({ "tool.execute.before": async () => {} })`,
        });
        const lines = checkDoctorV2(TEST_ROOT);
        expect(lines.some((l) => l.includes('legacy') && l.includes('V1'))).toBe(true);
        expect(lines.some((l) => l.startsWith('✅ controller: plugin active'))).toBe(false);
    });

    it('accepts a V2 plugin file', () => {
        writeProject({
            'opencode.json': '{}',
            '.opencode/plugins/ostacky-plugin.ts': `import { Plugin } from "@opencode/plugin"\nexport default Plugin.define({ id: "ostacky-controller", async setup(ctx) {} })`,
        });
        const lines = checkDoctorV2(TEST_ROOT);
        expect(lines.some((l) => l.startsWith('✅ controller: plugin V2'))).toBe(true);
    });

    it('warns on legacy mcp.<name>.enabled and accepts mcp.servers', () => {
        writeProject({
            'opencode.json': JSON.stringify({
                mcp: {
                    codegraph: { type: 'local', command: ['x'], enabled: true },
                    servers: { engram: { type: 'local', command: ['y'], disabled: false } },
                },
            }),
        });
        const lines = checkDoctorV2(TEST_ROOT);
        expect(lines.some((l) => l.includes('mcp.codegraph') && l.includes('servers'))).toBe(true);
        expect(lines.some((l) => l.includes('mcp.servers: OK'))).toBe(true);
    });

    it('warns warn-only on foreign legacy keys without touching them', () => {
        writeProject({
            'opencode.json': JSON.stringify({
                permission: { bash: { 'git push *': 'ask' } },
                agent: { reviewer: { prompt: 'x' } },
            }),
        });
        const lines = checkDoctorV2(TEST_ROOT);
        expect(lines.some((l) => l.includes('permission') && l.includes('permissions'))).toBe(true);
        expect(lines.some((l) => l.includes('agent') && l.includes('agents'))).toBe(true);
    });

    it('warns when a local mcp command binary does not exist', () => {
        writeProject({
            'opencode.json': JSON.stringify({
                mcp: { servers: { codegraph: { type: 'local', command: ['/no/existe/codegraph', 'serve'] } } },
            }),
        });
        const lines = checkDoctorV2(TEST_ROOT);
        expect(lines.some((l) => l.includes('codegraph') && l.includes('no existe'))).toBe(true);
    });

    it('is graceful without opencode.json', () => {
        mkdirSync(TEST_ROOT, { recursive: true });
        expect(() => checkDoctorV2(TEST_ROOT)).not.toThrow();
    });
});
