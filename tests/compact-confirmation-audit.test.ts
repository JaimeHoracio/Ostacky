import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Test ESTRUCTURAL: el handler de ostacky_compact_decision vive dentro de un closure del plugin
// y no es importable sin el runtime de OpenCode. Verifica que la rama continue/opt-out registra
// una entrada de audit con phase CONFIRMATION (paridad con record_user_confirmation del MCP).
const src = readFileSync(join(import.meta.dir, '..', 'assets/plugins/ostacky-controller/index.ts'), 'utf-8');

describe('ostacky_compact_decision: confirmación auditada', () => {
    it('la rama continue/opt-out escribe audit con phase CONFIRMATION', () => {
        const re = /compactAudit\(sid,\s*`compact-\$\{decision\}`,[^\n]*"CONFIRMATION"\)/;
        expect(re.test(src)).toBe(true);
    });

    it('compactAudit acepta phase opcional con default WARN', () => {
        expect(src).toMatch(/const compactAudit = \(sid: string \| null, decision: string, reasoning: string, phase: string = "WARN"\)/);
    });

    it('compact-requested y compact-failed conservan phase WARN (no son confirmaciones)', () => {
        expect(src).toMatch(/compactAudit\(sid, "compact-requested", `tokens=\$\{assist\.tokens\}`\)/);
        expect(src).toMatch(/compactAudit\(sid, "compact-failed", String\(err\?\.message \?\? err\)\)/);
    });
});
