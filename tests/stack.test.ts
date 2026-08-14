import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { buildEngramDownloadUrl, buildLocalMcpCommand, OPENSPEC_NPM_PACKAGE } from '../src/stack.js';

describe('buildEngramDownloadUrl', () => {
    it("uses Engram's Windows release platform identifier", () => {
        expect(buildEngramDownloadUrl('v1.20.0', 'win32', 'x64')).toBe(
            'https://github.com/Gentleman-Programming/engram/releases/download/v1.20.0/engram_1.20.0_windows_amd64.zip'
        );
    });

    it('returns null for an unsupported release platform', () => {
        expect(buildEngramDownloadUrl('v1.20.0', 'freebsd', 'x64')).toBeNull();
    });
});

describe('buildLocalMcpCommand', () => {
    it('configures Windows command shims through cmd.exe', () => {
        expect(buildLocalMcpCommand('C:/tools/codegraph.cmd', ['serve', '--mcp'], 'win32')).toEqual([
            'cmd.exe',
            '/d',
            '/c',
            'call',
            'C:/tools/codegraph.cmd',
            'serve',
            '--mcp',
        ]);
    });
});

describe('OPENSPEC_NPM_PACKAGE', () => {
    it('uses the scoped @fission-ai/openspec package (regression: npm squat "openspec" without bin)', () => {
        // The npm registry currently has a stub published under the unscoped name
        // `openspec` that has no executable, so `bunx openspec init` fails with
        // `could not determine executable to run for package openspec`. We must
        // always use the real, scoped package.
        expect(OPENSPEC_NPM_PACKAGE).toBe('@fission-ai/openspec');
        expect(OPENSPEC_NPM_PACKAGE.startsWith('@')).toBe(true);
        expect(OPENSPEC_NPM_PACKAGE).not.toBe('openspec');
    });
});

// ─── setupOpenSpec fallback chain (E4) ──────────────────────────────────────────

type ExecCall = { command: string; args: string[] };
type ScriptedExec = (call: ExecCall, callIndex: number) => boolean; // true = throw

describe('setupOpenSpec fallback chain', () => {
    let execCalls: ExecCall[] = [];
    let available: { bun: boolean; npm: boolean } = { bun: true, npm: false };
    let script: ScriptedExec = () => false;

    beforeEach(() => {
        execCalls = [];
        available = { bun: true, npm: false };
        script = () => false;
        mock.module('../src/fs.js', () => {
            const actual = require('../src/fs.js');
            return {
                ...actual,
                isCommandAvailable: (cmd: string) => {
                    if (cmd === 'bun') return available.bun;
                    if (cmd === 'npm') return available.npm;
                    return actual.isCommandAvailable(cmd);
                },
            };
        });
        mock.module('child_process', () => ({
            execFileSync: (command: string, args: string[]) => {
                const call: ExecCall = { command, args: [...args] };
                execCalls.push(call);
                if (script(call, execCalls.length - 1)) {
                    throw new Error(`simulated failure: ${command} ${args.join(' ')}`);
                }
                return Buffer.alloc(0);
            },
        }));
    });

    afterEach(() => {
        mock.restore();
    });

    it('succeeds via tryDirect when bunx works on first try', async () => {
        const { setupOpenSpec } = await import('../src/stack.js');
        const result = setupOpenSpec('/tmp/fake-root');
        expect(result.success).toBe(true);
        expect(result.message).toBe('OpenSpec configurado para OpenCode');
        // Only one exec call expected: bunx with the scoped package name.
        expect(execCalls).toHaveLength(1);
        expect(execCalls[0].command).toBe('bunx');
        expect(execCalls[0].args).toEqual([
            '@fission-ai/openspec',
            'init',
            '--tools',
            'opencode',
            '--force',
        ]);
    });

    it('falls back to global install when bunx fails (covers edge-case resolver)', async () => {
        // First call (bunx) throws. Subsequent calls succeed.
        script = (_call, i) => i === 0;
        const { setupOpenSpec } = await import('../src/stack.js');
        const result = setupOpenSpec('/tmp/fake-root');
        expect(result.success).toBe(true);
        expect(result.message).toMatch(/instalado globalmente con bun/);
        // Expect 3 calls: bunx (fail), bun add -g, openspec init (success).
        expect(execCalls).toHaveLength(3);
        expect(execCalls[0].command).toBe('bunx');
        expect(execCalls[1].command).toBe('bun');
        expect(execCalls[1].args).toEqual(['add', '-g', '@fission-ai/openspec']);
        expect(execCalls[2].command).toBe('openspec');
        expect(execCalls[2].args).toEqual(['init', '--tools', 'opencode', '--force']);
    });

    it('returns actionable error when both bunx and global install fail', async () => {
        // All exec calls fail.
        script = () => true;
        const { setupOpenSpec } = await import('../src/stack.js');
        const result = setupOpenSpec('/tmp/fake-root');
        expect(result.success).toBe(false);
        expect(result.message).toMatch(/Soluci\u00f3n manual: ejecuta `bun add -g @fission-ai\/openspec`/);
        expect(result.message).toMatch(/install-stack de nuevo/);
        expect(result.message).toMatch(/Detalle:/);
    });

    it('uses npm fallback when bun is unavailable', async () => {
        available = { bun: false, npm: true };
        // First call (npx) throws. Subsequent calls succeed.
        script = (_call, i) => i === 0;
        const { setupOpenSpec } = await import('../src/stack.js');
        const result = setupOpenSpec('/tmp/fake-root');
        expect(result.success).toBe(true);
        expect(result.message).toMatch(/instalado globalmente con npm/);
        expect(execCalls[0].command).toBe('npx');
        expect(execCalls[0].args[0]).toBe('--yes'); // npx needs --yes
        expect(execCalls[1].command).toBe('npm');
        expect(execCalls[1].args).toEqual(['install', '-g', '@fission-ai/openspec']);
    });

    it('skips global install when neither bun nor npm is available', async () => {
        available = { bun: false, npm: false };
        script = () => true; // bunx fails
        const { setupOpenSpec } = await import('../src/stack.js');
        const result = setupOpenSpec('/tmp/fake-root');
        expect(result.success).toBe(false);
        expect(result.message).toMatch(/Soluci\u00f3n manual: ejecuta `npm install -g/);
        // Only the initial npx attempt should have happened.
        expect(execCalls).toHaveLength(1);
        expect(execCalls[0].command).toBe('npx');
    });
});
