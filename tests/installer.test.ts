import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createMcpConfigEntry, probeMcpServer } from '../src/installer.js';

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
            enabled: true,
            environment: {
                OSTACKY_STATE_PATH: 'C:/workspace/.opencode/ostacky-state.json',
            },
        });
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
            enabled: true,
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

    it('controller probe still enforces ping + start_request when defaults are used', async () => {
        // Backward-compat guarantee: when no options are passed, the probe must
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
