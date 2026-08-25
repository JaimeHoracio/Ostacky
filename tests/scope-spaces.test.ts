import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import {
  getGlobalOpenCodeDir,
  getOpenCodeDirForScope,
  parseScopeArg,
  getCommandInvocation,
} from '../src/fs.js';
import { buildLocalMcpCommand } from '../src/stack.js';
import { createMcpConfigEntry } from '../src/installer.js';
import { findOpenCodeConfig, readOpenCodeConfig, writeOpenCodeConfig } from '../src/config.js';

const TMP_PREFIX = join(tmpdir(), 'ostacky-scope-spaces-');
let tmpRoot: string;

beforeEach(() => {
  // tmp dir with spaces: /tmp/ostacky-scope-spaces-XXXXXX/a b c
  const base = tmpRoot = join(TMP_PREFIX + Date.now(), 'a b', 'c d');
  mkdirSync(base, { recursive: true });
});

afterEach(() => {
  if (tmpRoot) {
    const top = tmpRoot.split('/a b')[0];
    if (existsSync(top)) rmSync(top, { recursive: true, force: true });
  }
});

describe('scope — Windows Desktop con espacios', () => {
  it('getGlobalOpenCodeDir respeta XDG_CONFIG_HOME (Unix) y APPDATA (win32)', () => {
    const prevXdg = process.env.XDG_CONFIG_HOME;
    const prevAppData = process.env.APPDATA;
    try {
      process.env.XDG_CONFIG_HOME = '/tmp/my custom config';
      expect(getGlobalOpenCodeDir('linux', '/home/test')).toBe('/tmp/my custom config/opencode');
      expect(getGlobalOpenCodeDir('darwin', '/home/test')).toBe('/tmp/my custom config/opencode');

      process.env.APPDATA = 'C:\\Users\\Jaime Horacio\\AppData\\Roaming';
      // homedir with space: C:\Users\Jaime Horacio
      expect(getGlobalOpenCodeDir('win32', 'C:\\Users\\Jaime Horacio')).toBe(
        'C:\\Users\\Jaime Horacio\\AppData\\Roaming\\opencode'
      );
      // fallback to homedir/AppData/Roaming when APPDATA no está
      delete process.env.APPDATA;
      expect(getGlobalOpenCodeDir('win32', 'C:\\Users\\Jaime Horacio')).toBe(
        'C:\\Users\\Jaime Horacio\\AppData\\Roaming\\opencode'
      );
    } finally {
      if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prevXdg;
      if (prevAppData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = prevAppData;
    }
  });

  it('getOpenCodeDirForScope prioriza local y maneja cwd con espacios', () => {
    const spacedCwd = join(tmpRoot, 'My Project');
    mkdirSync(spacedCwd, { recursive: true });
    mkdirSync(join(spacedCwd, '.git'), { recursive: true });

    const local = getOpenCodeDirForScope('local', spacedCwd);
    expect(local).toBe(join(spacedCwd, '.opencode'));

    const autoWithGit = getOpenCodeDirForScope('auto', spacedCwd);
    expect(autoWithGit).toBe(join(spacedCwd, '.opencode'));

    // auto sin .git ni .opencode → global
    const emptySpaced = join(tmpRoot, 'Empty Project With Spaces');
    mkdirSync(emptySpaced, { recursive: true });
    const autoEmpty = getOpenCodeDirForScope('auto', emptySpaced);
    expect(autoEmpty).toBe(getGlobalOpenCodeDir());

    // global siempre es global, aunque cwd tenga espacios
    const globalDir = getOpenCodeDirForScope('global', spacedCwd);
    expect(globalDir).toBe(getGlobalOpenCodeDir());
  });

  it('parseScopeArg soporta --scope local y --scope=global en cualquier posición', () => {
    expect(parseScopeArg(['node', 'cli', '--scope', 'local'])).toBe('local');
    expect(parseScopeArg(['node', 'cli', '--scope=global'])).toBe('global');
    expect(parseScopeArg(['node', 'cli', 'install', '--scope', 'auto'])).toBe('auto');
    expect(parseScopeArg(['node', 'cli', 'install', '--scope=local', 'extra'])).toBe('local');
    expect(parseScopeArg(['node', 'cli', 'install'])).toBe(null);
    expect(parseScopeArg(['node', 'cli', '--scope', 'invalid'])).toBe(null);
  });

  it('getCommandInvocation NO hace pre-quoting con espacios (array seguro vía libuv)', () => {
    // Caso crítico: Desktop con espacios y caracteres especiales
    const winPath = 'C:\\Users\\Jaime Horacio\\Desktop\\My Project\\.opencode\\tools\\codegraph\\bin\\codegraph.cmd';
    const inv = getCommandInvocation(winPath, ['serve', '--mcp', '--arg with spaces'], 'win32');
    expect(inv.command).toBe('cmd.exe');
    // El path con espacios debe ir SIN comillas extra — libuv lo escapa
    expect(inv.args).toEqual(['/d', '/c', 'call', winPath, 'serve', '--mcp', '--arg with spaces']);
    // Verificar que NO hay quoting manual
    for (const a of inv.args) expect(a.startsWith('"')).toBe(false);

    // En linux no se envuelve
    expect(getCommandInvocation('/tmp/a b/c d/bin/codegraph', ['--version'], 'linux')).toEqual({
      command: '/tmp/a b/c d/bin/codegraph',
      args: ['--version'],
    });
  });

  it('buildLocalMcpCommand preserva espacios sin quoting (array)', () => {
    const exe = 'C:\\Users\\Jaime Horacio\\Desktop\\My Project\\.opencode\\mcp\\ostacky-controller\\index.js';
    const nodeExe = 'C:\\Program Files\\nodejs\\node.exe';
    // buildLocalMcpCommand usa getCommandInvocation internamente
    const cmd = buildLocalMcpCommand(nodeExe, [exe, '--flag'], 'win32');
    // node.exe no es .cmd, no se envuelve en cmd.exe
    expect(cmd[0]).toBe(nodeExe);
    expect(cmd[1]).toBe(exe);
    // Pero si exe fuera .cmd, sí se envolvería
    const cmd2 = buildLocalMcpCommand(
      'C:\\Users\\Jaime Horacio\\Desktop\\My Project\\.opencode\\tools\\codegraph\\bin\\codegraph.cmd',
      ['serve', '--mcp'],
      'win32'
    );
    expect(cmd2[0]).toBe('cmd.exe');
    expect(cmd2).toContain('C:\\Users\\Jaime Horacio\\Desktop\\My Project\\.opencode\\tools\\codegraph\\bin\\codegraph.cmd');
  });

  it('createMcpConfigEntry guarda command como array (espacios seguros, sin shell string)', () => {
    const proj = join(tmpRoot, 'My Project With Spaces');
    mkdirSync(proj, { recursive: true });
    const nodeExe = 'C:\\Program Files\\nodejs\\node.exe';
    const serverPath = 'C:\\Users\\Jaime Horacio\\Desktop\\My Project With Spaces\\.opencode\\mcp\\ostacky-controller\\index.js';
    const statePath = join(proj, '.opencode', 'ostacky-state.json');
    const entry = createMcpConfigEntry('ostacky-controller', nodeExe, serverPath, statePath);
    expect(entry.command).toEqual([nodeExe, serverPath]);
    // No es string con espacios escapados
    expect(typeof entry.command).not.toBe('string');
    expect((entry.command as string[]).join(' ')).toContain('Jaime Horacio');
  });

  it('opencode.json con command array sobrevive round-trip con espacios (write/read)', () => {
    const proj = join(tmpRoot, 'Project With Spaces');
    mkdirSync(proj, { recursive: true });
    const cfgPath = join(proj, 'opencode.json');
    const nodeExe = 'C:\\Program Files\\nodejs\\node.exe';
    const serverPath = 'C:\\Users\\A B\\My Project\\.opencode\\mcp\\ostacky-controller\\index.js';
    const statePath = 'C:\\Users\\A B\\My Project\\.opencode\\ostacky-state.json';
    const entry = createMcpConfigEntry('ostacky-controller', nodeExe, serverPath, statePath);
    // Simular escritura como hace setMcpEntryAtProjectRoot
    writeOpenCodeConfig(cfgPath, { mcp: { 'ostacky-controller': entry } });
    expect(existsSync(cfgPath)).toBe(true);
    const read = readOpenCodeConfig(cfgPath) as any;
    expect(read.mcp['ostacky-controller'].command).toEqual([nodeExe, serverPath]);
    expect(read.mcp['ostacky-controller'].environment.OSTACKY_STATE_PATH).toBe(statePath);
    // Verificar JSON crudo contiene array, no shell string con comillas
    const raw = require('fs').readFileSync(cfgPath, 'utf8');
    expect(raw).toContain('"C:\\\\Program Files\\\\nodejs\\\\node.exe"');
  });

  it('tools permanecen locales aunque cwd tenga espacios — getOpenCodeDirForScope no mueve tools a global', () => {
    const spacedProj = join(tmpRoot, 'Desktop', 'My Project With Spaces');
    mkdirSync(spacedProj, { recursive: true });
    const localTools = join(getOpenCodeDirForScope('local', spacedProj), 'tools');
    const globalTools = join(getGlobalOpenCodeDir(), 'tools');
    expect(localTools).toContain('My Project With Spaces');
    expect(localTools).not.toBe(globalTools);
  });
});
