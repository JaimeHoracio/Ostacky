import { describe, it, expect, afterEach } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ensureMcpEntryAtProjectRoot, stripJsoncComments, setMcpEntryAtProjectRoot } from '../src/config.js';

const TEST_ROOT = join(import.meta.dir, '.test-config-project');

afterEach(() => {
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe('stripJsoncComments', () => {
    it('passes through plain JSON unchanged', () => {
        const input = `{"a": 1, "b": "hello"}`;
        expect(stripJsoncComments(input)).toBe(input);
    });

    it('strips single-line comments', () => {
        const input = `{\n  // this is a comment\n  "a": 1\n}`;
        const expected = `{\n  \n  "a": 1\n}`;
        expect(stripJsoncComments(input)).toBe(expected);
    });

    it('strips multi-line comments', () => {
        const input = `{\n  /* block\n  comment */\n  "a": 1\n}`;
        const result = stripJsoncComments(input);
        expect(result).not.toContain('/*');
        expect(result).not.toContain('*/');
        expect(result).toContain('"a": 1');
    });

    it('preserves strings containing //', () => {
        const input = `{"url": "http://example.com"}`;
        expect(stripJsoncComments(input)).toBe(input);
    });

    it('preserves strings containing /*', () => {
        const input = `{"regex": "/* comment */"}`;
        expect(stripJsoncComments(input)).toBe(input);
    });

    it('handles escaped quotes inside strings', () => {
        const input = `{"msg": "hello \\"world\\""}`;
        expect(stripJsoncComments(input)).toBe(input);
    });

    it('strips trailing commas before }', () => {
        const input = `{"a": 1, "b": 2,}`;
        expect(stripJsoncComments(input)).toBe(`{"a": 1, "b": 2}`);
    });

    it('strips trailing commas before ]', () => {
        const input = `[1, 2, 3,]`;
        expect(stripJsoncComments(input)).toBe(`[1, 2, 3]`);
    });

    it('handles empty object', () => {
        expect(stripJsoncComments('{}')).toBe('{}');
    });

    it('handles empty array', () => {
        expect(stripJsoncComments('[]')).toBe('[]');
    });

    it('strips comments after valid JSON', () => {
        const input = `{"a": 1} // trailing comment`;
        const result = stripJsoncComments(input);
        expect(result).toBe(`{"a": 1} `);
    });

    it('works with real-world opencode.jsonc', () => {
        const input = `{
  "$schema": "https://opencode.ai/config.json",
  // MCP servers
  "mcp": {
    "codegraph": {
      "type": "local",
      "command": [".opencode/tools/codegraph/bin/codegraph", "serve", "--mcp"],
      "enabled": true
    }
  }
}`;
        const result = stripJsoncComments(input);
        // Should parse as valid JSON after stripping
        expect(() => JSON.parse(result)).not.toThrow();
        const parsed = JSON.parse(result);
        expect(parsed.mcp.codegraph.type).toBe('local');
    });
});

describe('setMcpEntryAtProjectRoot', () => {
    it('reconciles an existing installer-managed MCP entry at the supplied project root', () => {
        mkdirSync(TEST_ROOT, { recursive: true });
        const configPath = join(TEST_ROOT, 'opencode.json');
        writeFileSync(
            configPath,
            JSON.stringify({
                mcp: {
                    'ostacky-controller': {
                        type: 'local',
                        command: ['node', 'stale/index.js'],
                        enabled: true,
                    },
                },
            }),
            'utf-8'
        );

        setMcpEntryAtProjectRoot(TEST_ROOT, 'ostacky-controller', {
            type: 'local',
            command: ['C:/Program Files/nodejs/node.exe', 'C:/project/.opencode/mcp/ostacky-controller/index.js'],
            enabled: true,
        });

        const config = JSON.parse(readFileSync(configPath, 'utf-8'));
        expect(config.mcp['ostacky-controller'].command).toEqual([
            'C:/Program Files/nodejs/node.exe',
            'C:/project/.opencode/mcp/ostacky-controller/index.js',
        ]);
    });

    it('fails instead of silently skipping an invalid OpenCode config', () => {
        mkdirSync(TEST_ROOT, { recursive: true });
        writeFileSync(join(TEST_ROOT, 'opencode.json'), '{ invalid json', 'utf-8');

        expect(() =>
            setMcpEntryAtProjectRoot(TEST_ROOT, 'ostacky-controller', {
                type: 'local',
                command: ['node', 'controller.js'],
                enabled: true,
            })
        ).toThrow('Error parseando');
    });
});

describe('ensureMcpEntryAtProjectRoot', () => {
    it('preserves an existing user-managed entry', () => {
        mkdirSync(TEST_ROOT, { recursive: true });
        const configPath = join(TEST_ROOT, 'opencode.json');
        writeFileSync(
            configPath,
            JSON.stringify({
                mcp: {
                    context7: { type: 'remote', url: 'https://custom.example/mcp' },
                },
            }),
            'utf-8'
        );

        ensureMcpEntryAtProjectRoot(TEST_ROOT, 'context7', {
            type: 'remote',
            url: 'https://mcp.context7.com/mcp',
            enabled: true,
        });

        const config = JSON.parse(readFileSync(configPath, 'utf-8'));
        expect(config.mcp.context7).toEqual({
            type: 'remote',
            url: 'https://custom.example/mcp',
        });
    });
});

describe('writeOpenCodeConfig', () => {
    it('leaves no temporary configuration files after an atomic write', () => {
        mkdirSync(TEST_ROOT, { recursive: true });
        setMcpEntryAtProjectRoot(TEST_ROOT, 'controller', {
            type: 'local',
            command: ['node', 'controller.js'],
            enabled: true,
        });

        expect(readdirSync(TEST_ROOT).some((entry) => entry.includes('.tmp.'))).toBe(false);
    });
});
