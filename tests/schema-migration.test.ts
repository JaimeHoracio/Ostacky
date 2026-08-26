import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OstackyController } from '../assets/mcp/ostacky-controller/index.js';

const TMP_PREFIX = join(tmpdir(), 'ostacky-migration-');
let tmp: string;

beforeEach(() => { tmp = mkdtempSync(TMP_PREFIX); });
afterEach(() => { if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true }); });

describe('schema migration v0→v1', () => {
  it('migra estado double-encoded snapshots.codegraph string a objeto y schemaVersion 1', async () => {
    const statePath = join(tmp, '.opencode', 'ostacky-state.json');
    mkdirSync(join(tmp, '.opencode'), { recursive: true });
    const doubleEncoded = JSON.stringify({ _compressed: true, symbols: [{ name: 'foo', kind: 'function', file: 'src/foo.ts' }] });
    const v0State = {
      state: 'EXECUTION_ANALYSIS',
      revision: 5,
      requestId: 'test',
      snapshots: { codegraph: doubleEncoded, execution: doubleEncoded },
      tasks: {},
      audit: [{ ts: Date.now(), phase: 'LEVEL_RESOLVED', decision: 'test' }], // missing id
      auditSeq: 0,
    };
    writeFileSync(statePath, JSON.stringify(v0State), 'utf-8');
    const c = new OstackyController({ statePath });
    const s = await c.getState();
    expect(s.schemaVersion).toBe(1);
    expect(typeof s.snapshots.codegraph).toBe('object');
    expect((s.snapshots.codegraph as any)._compressed).toBe(true);
    expect(s.audit[0].id).toBeDefined();
    expect(s.audit[0].id.startsWith('aud-')).toBe(true);
  });

  it('backup rotation funciona: estado corrupto con .backup también corrupto pero .backup.1 válido restaura', async () => {
    const statePath = join(tmp, '.opencode', 'ostacky-state.json');
    mkdirSync(join(tmp, '.opencode'), { recursive: true });
    // primary corrupt
    writeFileSync(statePath, 'not json', 'utf-8');
    // .backup corrupt
    writeFileSync(statePath + '.backup', 'also not json', 'utf-8');
    // .backup.1 valid
    const valid = {
      state: 'INTERPRETATION_PENDING',
      revision: 99,
      snapshots: { codegraph: null, execution: null },
      tasks: {},
      audit: [],
      auditSeq: 0,
      schemaVersion: 1,
    };
    writeFileSync(statePath + '.backup.1', JSON.stringify(valid), 'utf-8');
    const c = new OstackyController({ statePath });
    const s = await c.getState();
    expect(s.revision).toBe(99);
    expect(s.error).toContain('State restored from');
  });
});
