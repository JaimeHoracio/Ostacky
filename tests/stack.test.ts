import { describe, expect, it } from 'bun:test';
import { buildEngramDownloadUrl, buildLocalMcpCommand } from '../src/stack.js';

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
