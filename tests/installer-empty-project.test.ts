import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { isGitRepo, isCommandAvailable, ensureOpenCodePaths, parseScopeArg } from '../src/fs.js';
import { doInstallAll, doInstallStack } from '../src/prompts/install.js';

describe('installer-empty-project: isGitRepo', () => {
    it('dir vacío sin git -> false y no lanza', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ostacky-nogit-'));
        try {
            expect(isGitRepo(dir)).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('dir con git init -> true', () => {
        if (!isCommandAvailable('git')) return;
        const dir = mkdtempSync(join(tmpdir(), 'ostacky-git-'));
        try {
            execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
            expect(isGitRepo(dir)).toBe(true);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('dir inexistente -> false y no lanza', () => {
        const missing = join(tmpdir(), 'ostacky-noexiste-12345');
        if (existsSync(missing)) rmSync(missing, { recursive: true, force: true });
        expect(isGitRepo(missing)).toBe(false);
    });

    it('subdir de repo -> true (worktree-aware)', () => {
        if (!isCommandAvailable('git')) return;
        const dir = mkdtempSync(join(tmpdir(), 'ostacky-sub-'));
        try {
            execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
            mkdirSync(join(dir, 'sub'), { recursive: true });
            expect(isGitRepo(join(dir, 'sub'))).toBe(true);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('installer-empty-project: -g legacy', () => {
    it('-g retorna marcador legacy (no se ignora en silencio)', () => {
        expect(parseScopeArg(['node', 'ostacky', '-g'])).toBe('__legacy_global__');
    });

    it('--scope global es scope válido (opt-in global)', () => {
        expect(parseScopeArg(['node', 'ostacky', '--scope', 'global'])).toBe('global');
        expect(parseScopeArg(['node', 'ostacky', '--scope=global'])).toBe('global');
    });

    it('--scope local sigue válido', () => {
        expect(parseScopeArg(['node', 'ostacky', 'install', '--scope', 'local'])).toBe('local');
    });

    it('sin flags retorna null (local implícito)', () => {
        expect(parseScopeArg(['node', 'ostacky', 'install'])).toBeNull();
    });
});

describe('installer-empty-project: doInstallAll --no-stack hermético', () => {
    it('dir vacío sin red: núcleo OK, sin tools/codegraph, cierra true', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'ostacky-nostack-'));
        try {
            const paths = ensureOpenCodePaths(join(dir, '.opencode'));
            const manifest: any = { version: '0.0.0-test', repo: 'x/y', tag: 'v0.0.0', agents: [], commands: [], skills: [], mcpServers: [] };
            const ok = await doInstallAll(manifest, paths, { noStack: true });
            expect(ok).toBe(true);
            expect(existsSync(join(paths.agents))).toBe(true);
            expect(existsSync(join(paths.tools, 'codegraph'))).toBe(false);
            expect(existsSync(join(paths.tools, 'engram'))).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }, 30_000);
});

describe('installer-empty-project: scope global omite el stack (regresión scope-loss)', () => {
    // Hermético: XDG_CONFIG_HOME apunta a un tmp → getGlobalOpenCodeDir() no toca el HOME real.
    const withFakeGlobal = async <T>(dir: string, fn: () => Promise<T>): Promise<T> => {
        const prevXdg = process.env.XDG_CONFIG_HOME;
        process.env.XDG_CONFIG_HOME = join(dir, 'xdg');
        try {
            return await fn();
        } finally {
            if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
            else process.env.XDG_CONFIG_HOME = prevXdg;
        }
    };

    it('doInstallAll con scope global: núcleo OK y stack omitido (sin tools/codegraph)', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'ostacky-global-'));
        try {
            await withFakeGlobal(dir, async () => {
                const paths = ensureOpenCodePaths(join(dir, '.opencode'));
                const manifest: any = { version: '0.0.0-test', repo: 'x/y', tag: 'v0.0.0', agents: [], commands: [], skills: [], mcpServers: [] };
                const ok = await doInstallAll(manifest, paths, { scope: 'global' });
                expect(ok).toBe(true);
                expect(existsSync(join(paths.tools, 'codegraph'))).toBe(false);
                expect(existsSync(join(paths.tools, 'engram'))).toBe(false);
            });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }, 30_000);

    it('doInstallStack con toolsDir global: omite con aviso, no deriva projectRoot erróneo', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'ostacky-gstack-'));
        try {
            await withFakeGlobal(dir, async () => {
                const { getGlobalOpenCodeDir } = await import('../src/fs.js');
                const globalDir = getGlobalOpenCodeDir(); // <tmp>/xdg/opencode
                const globalTools = join(globalDir, 'tools');
                const derivedProjectRoot = join(globalDir, '..'); // el "padre" erróneo del bug original
                const ok = await doInstallStack(globalTools, derivedProjectRoot);
                expect(ok).toBe(true);
                // ni en el projectRoot derivado ni en el dir global se crean artefactos del stack
                expect(existsSync(join(derivedProjectRoot, '.opencode', 'tools', 'codegraph'))).toBe(false);
                expect(existsSync(join(globalTools, 'codegraph'))).toBe(false);
            });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }, 30_000);
});
