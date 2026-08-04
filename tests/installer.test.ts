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
});
