import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMcpConfigEntry, probeMcpServer, uninstallMcpServer } from '../src/installer.js';
import type { OpenCodePaths } from '../src/types.js';

const PROBE_STATE = join(import.meta.dir, '.test-controller-probe-state.json');

afterEach(() => {
    if (existsSync(PROBE_STATE)) rmSync(PROBE_STATE, { force: true });
    if (existsSync(PROBE_STATE + '.backup')) rmSync(PROBE_STATE + '.backup', { force: true });
});

describe('createMcpConfigEntry', () => {
    it('uses resolved executable paths and an explicit controller state path', () => {
        expect(
            createMcpConfigEntry(
                'ostacky-controller',
                'C:/Program Files/nodejs/node.exe',
                'C:/workspace/.opencode/mcp/ostacky-controller/index.js',
                'C:/workspace/.opencode/ostacky-state.json'
            )
        ).toEqual({
            type: 'local',
            command: ['C:/Program Files/nodejs/node.exe', 'C:/workspace/.opencode/mcp/ostacky-controller/index.js'],
            disabled: false,
            timeout: { catalog: 30000, execution: 300000 },
            protocol: 'legacy',
            environment: {
                OSTACKY_STATE_PATH: 'C:/workspace/.opencode/ostacky-state.json',
            },
        });
    });

    it('uses V2 native shape without legacy enabled', () => {
        const entry = createMcpConfigEntry(
            'codegraph',
            '/usr/bin/node',
            '/w/.opencode/mcp/codegraph/index.js'
        ) as Record<string, unknown>;
        expect('enabled' in entry).toBe(false);
        expect(entry.disabled).toBe(false);
    });

    it('does not add controller-only environment to other MCP servers', () => {
        expect(
            createMcpConfigEntry(
                'openspec',
                'C:/Program Files/nodejs/node.exe',
                'C:/workspace/.opencode/mcp/openspec/index.js'
            )
        ).toEqual({
            type: 'local',
            command: ['C:/Program Files/nodejs/node.exe', 'C:/workspace/.opencode/mcp/openspec/index.js'],
            disabled: false,
            timeout: { catalog: 30000, execution: 300000 },
            protocol: 'legacy',
        });
    });

    it('performs an initialize and tools/list readiness probe for the controller', async () => {
        await expect(
            probeMcpServer(
                process.execPath,
                join(import.meta.dir, '..', 'assets', 'mcp', 'ostacky-controller', 'index.js'),
                join(import.meta.dir, '..'),
                PROBE_STATE
            )
        ).resolves.toBeUndefined();
        expect(existsSync(PROBE_STATE + '.backup')).toBe(false);
    });

    it('probes non-controller MCPs (e.g. openspec) with handshake-only validation (regression: E2)', async () => {
        // Regression test for the OpenSpec install bug: the bundled openspec MCP
        // exposes `openspec_list`, `openspec_propose`, `openspec_archive`,
        // `openspec_get_change` — it does NOT expose `ping` (in MCP spec `ping`
        // is a JSON-RPC method, not a tool) nor `start_request`. The previous
        // probe required both as tools on every MCP, breaking install of openspec.
        // Now we accept a per-MCP probe contract: openspec only needs the
        // handshake to succeed (initialize + notifications/initialized +
        // tools/list without errors).
        await expect(
            probeMcpServer(
                process.execPath,
                join(import.meta.dir, '..', 'assets', 'mcp', 'openspec', 'index.js'),
                join(import.meta.dir, '..'),
                undefined,
                { requiredTools: [], exerciseWrite: false }
            )
        ).resolves.toBeUndefined();
    });

    it('rejects MCPs that lack the narrowed required tools', async () => {
        // Sanity check: the narrowed contract still validates. If we ask for a
        // tool the MCP does not expose, the probe must fail loudly rather than
        // silently passing. Here we ask openspec for `start_request` (which it
        // doesn't have), expecting a rejection with that name in the message.
        await expect(
            probeMcpServer(
                process.execPath,
                join(import.meta.dir, '..', 'assets', 'mcp', 'openspec', 'index.js'),
                join(import.meta.dir, '..'),
                undefined,
                { requiredTools: ['start_request'], exerciseWrite: false }
            )
        ).rejects.toThrow(/start_request/);
    });

    it('controller probe still enforces ping + start_request when defaults are used', async () => {        // Backward-compat guarantee: when no options are passed, the probe must
        // still require ping+start_request and exercise start_request. This is
        // verified indirectly by the previous "controller" test, but we add this
        // explicit assertion so a future refactor that loosens defaults is caught.
        // We use the openspec MCP (which lacks both) to prove the defaults still bite.
        await expect(
            probeMcpServer(
                process.execPath,
                join(import.meta.dir, '..', 'assets', 'mcp', 'openspec', 'index.js'),
                join(import.meta.dir, '..')
            )
        ).rejects.toThrow(/ping|start_request/);
    });
});

describe('uninstallMcpServer', () => {
    const TEST_PROJ = join(import.meta.dir, '.test-uninstall-project');
    const paths = (root: string): OpenCodePaths => ({
        root,
        agents: join(root, 'agents'),
        commands: join(root, 'commands'),
        plugins: join(root, 'plugins'),
        skills: join(root, 'skills'),
        mcp: join(root, 'mcp'),
        tools: join(root, 'tools'),
    });

    it('removes V2 servers and legacy entries but never user plugins', () => {
        const projectRoot = TEST_PROJ;
        const root = join(projectRoot, '.opencode');
        mkdirSync(join(root, 'mcp', 'codegraph'), { recursive: true });
        writeFileSync(
            join(projectRoot, 'opencode.json'),
            JSON.stringify({
                mcp: {
                    servers: {
                        codegraph: { type: 'local', command: ['x'] },
                        'my-user-mcp': { type: 'remote', url: 'https://u.example/mcp' },
                    },
                    codegraph: { type: 'local', command: ['stale'], enabled: true },
                },
                plugins: ['mi-plugin'],
            }),
            'utf-8'
        );

        expect(uninstallMcpServer('codegraph', paths(root))).toBe(true);
        const config = JSON.parse(readFileSync(join(projectRoot, 'opencode.json'), 'utf-8'));
        expect(config.mcp.servers.codegraph).toBeUndefined();
        expect(config.mcp.codegraph).toBeUndefined();
        expect(config.mcp.servers['my-user-mcp'].url).toBe('https://u.example/mcp');
        expect(config.plugins).toEqual(['mi-plugin']);
        expect(existsSync(join(root, 'mcp', 'codegraph'))).toBe(false);
        rmSync(TEST_PROJ, { recursive: true, force: true });
    });
});
