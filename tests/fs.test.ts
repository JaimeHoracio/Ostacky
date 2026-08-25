import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
    detectPlatformTarget,
    findBinaryInDir,
    getCommandInvocation,
    getEngramReleaseTarget,
    getExecutableName,
    promoteStagedDirectory,
    shouldRetryDownload,
} from '../src/fs.js';

const TEST_ROOT = join(import.meta.dir, '.test-fs-project');

afterEach(() => {
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe('release platform helpers', () => {
    it("keeps CodeGraph's Windows release target in Node platform naming", () => {
        expect(detectPlatformTarget('win32', 'x64')).toBe('win32-x64');
    });

    it("maps Node's Windows platform name to Engram's release naming", () => {
        expect(getEngramReleaseTarget('win32', 'x64')).toBe('windows-amd64');
        expect(getEngramReleaseTarget('win32', 'arm64')).toBe('windows-arm64');
    });

    it('uses the executable extension required by Windows consistently', () => {
        expect(getExecutableName('codegraph', 'win32')).toBe('codegraph.exe');
        expect(getExecutableName('codegraph', 'linux')).toBe('codegraph');
    });

    it("finds CodeGraph's Windows command launcher when no .exe is present", () => {
        if (process.platform !== 'win32') return;
        const binDir = join(TEST_ROOT, 'codegraph', 'bin');
        mkdirSync(binDir, { recursive: true });
        const commandPath = join(binDir, 'codegraph.cmd');
        writeFileSync(commandPath, '@echo off', 'utf-8');

        expect(findBinaryInDir(join(TEST_ROOT, 'codegraph'), 'codegraph')).toBe(commandPath);
    });

    it('wraps Windows command shims in cmd.exe instead of executing .cmd directly', () => {
        expect(getCommandInvocation('npm', ['install'], 'win32')).toEqual({
            command: 'cmd.exe',
            args: ['/d', '/c', 'call', 'npm', 'install'],
        });
        expect(getCommandInvocation('C:/tools/codegraph.cmd', ['serve', '--mcp'], 'win32')).toEqual({
            command: 'cmd.exe',
            args: ['/d', '/c', 'call', 'C:/tools/codegraph.cmd', 'serve', '--mcp'],
        });
        expect(getCommandInvocation('C:/tools&unsafe/codegraph.cmd', ['serve'], 'win32')).toEqual({
            command: 'cmd.exe',
            args: ['/d', '/c', 'call', 'C:/tools&unsafe/codegraph.cmd', 'serve'],
        });
    });

    it('runs a Windows command shim whose path contains spaces', () => {
        if (process.platform !== 'win32') return;
        const commandPath = join(TEST_ROOT, 'tool with spaces.cmd');
        mkdirSync(TEST_ROOT, { recursive: true });
        writeFileSync(commandPath, '@echo %1', 'utf-8');

        const invocation = getCommandInvocation(commandPath, ['ready']);
        expect(
            execFileSync(invocation.command, invocation.args, {
                encoding: 'utf-8',
            }).trim()
        ).toBe('ready');
    });
});

describe('download retry classification', () => {
    it('does not retry permanent HTTP failures', () => {
        expect(shouldRetryDownload(new Error('HTTP 404 Not Found descargando https://example.test/archive.zip'))).toBe(
            false
        );
    });

    it('retries throttling and transient network failures', () => {
        expect(
            shouldRetryDownload(new Error('HTTP 429 Too Many Requests descargando https://example.test/archive.zip'))
        ).toBe(true);
        expect(shouldRetryDownload(new Error('fetch failed: ECONNRESET'))).toBe(true);
    });
});

describe('T6: paths con espacios — downloadAndExtract/promote', () => {
    it('maneja paths con espacios via invocación por array (sin pre-quoting)', () => {
        const baseWithSpaces = join(TEST_ROOT, 'a b');
        const staged = join(baseWithSpaces, 'staged with spaces');
        const destDir = join(baseWithSpaces, 'dest with spaces');
        mkdirSync(staged, { recursive: true });
        writeFileSync(join(staged, 'hello.txt'), 'hola', 'utf-8');
        // promoteStagedDirectory debe tolerar espacios (array invocation en downloadAndExtract ya lo hace: execFileSync("tar", [...]))
        const promo = promoteStagedDirectory(staged, destDir);
        expect(readFileSync(join(destDir, 'hello.txt'), 'utf-8')).toBe('hola');
        // getCommandInvocation preserva espacios sin quoting
        const inv = getCommandInvocation(join(baseWithSpaces, 'tool with spaces.cmd'), ['arg with spaces'], 'win32');
        expect(inv.args).toContain('arg with spaces');
        promo.commit();
    });
});

describe('promoteStagedDirectory', () => {
    it('restores a working installation when validation after promotion fails', () => {
        const destination = join(TEST_ROOT, 'tool');
        const staged = join(TEST_ROOT, 'staged');
        mkdirSync(destination, { recursive: true });
        mkdirSync(staged, { recursive: true });
        writeFileSync(join(destination, 'version.txt'), 'old', 'utf-8');
        writeFileSync(join(staged, 'version.txt'), 'new', 'utf-8');

        const promotion = promoteStagedDirectory(staged, destination);
        expect(readFileSync(join(destination, 'version.txt'), 'utf-8')).toBe('new');

        promotion.rollback();
        expect(readFileSync(join(destination, 'version.txt'), 'utf-8')).toBe('old');
    });
});
