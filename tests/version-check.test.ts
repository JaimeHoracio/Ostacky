import { describe, expect, it } from 'bun:test';
import { parseMajor, compareVersions, decideOffer, canPrompt } from '../src/version-check.js';

describe('version-check', () => {
  it('parseMajor extrae major (con o sin v)', () => {
    expect(parseMajor('1.4.2')).toBe(1);
    expect(parseMajor('v2.0.0')).toBe(2);
    expect(parseMajor('0.10.1')).toBe(0);
    expect(parseMajor(null)).toBe(null);
    expect(parseMajor('foo')).toBe(null);
  });

  it('compareVersions ordena semver', () => {
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
    expect(compareVersions('v2.1.0', '2.0.9')).toBe(1);
  });

  it('decideOffer: v1 instalada + latest v2 → migrate-v1', () => {
    expect(decideOffer('1.4.2', '2.0.0').kind).toBe('migrate-v1');
  });

  it('decideOffer: misma o más nueva → none; latest null → none', () => {
    expect(decideOffer('0.10.1', '0.10.1').kind).toBe('none');
    expect(decideOffer('0.10.1', '0.9.5').kind).toBe('none');
    expect(decideOffer('0.10.1', null).kind).toBe('none');
  });

  it('decideOffer: update disponible (no v1) → update-available', () => {
    expect(decideOffer('0.10.1', '0.11.0').kind).toBe('update-available');
  });

  it('canPrompt: no-interactivo o --yes → false (default seguro No)', () => {
    expect(canPrompt(['node', 'cli', '--yes'], true)).toBe(false);
    expect(canPrompt(['node', 'cli'], false)).toBe(false);
    expect(canPrompt(['node', 'cli'], true)).toBe(true);
  });
});
