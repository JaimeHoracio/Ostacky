/**
 * Regression: drift entre el manifest de GitHub (tag) y los assets bundleados
 * en el tarball npm.
 *
 * Incidente v0.9.2: loadManifest() baja manifest.json desde GitHub tag v0.9.2
 * (hash ac2f546) pero los assets de skills/MCP viven en el paquete npm
 * (hash 29857bf, regenerados por prepublishOnly sin commitear). La validación
 * de integridad fallaba para todos los usuarios.
 *
 * Invariante: el hash esperado SIEMPRE sale del manifest bundleado (mismo
 * origen que los assets). El manifest remoto solo sirve para listar/versionar.
 */
import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getBundledExpectedHash } from '../src/github.js';
import type { Manifest } from '../src/github.js';
import { assertBundledTreeHash, installSkill } from '../src/installer.js';
import type { OpenCodePaths } from '../src/types.js';
import { computeTreeHash } from '../src/fs.js';

/** El hash real del tag v0.9.2 en GitHub, tal como quedó en el incidente. */
const STALE_REMOTE_HASH = 'ac2f5465f7bc9cc938fde549390ff0075e914983e10b7c4074fb9670ecb1fe03';

function pathsFor(root: string): OpenCodePaths {
    return {
        root,
        agents: join(root, 'agents'),
        commands: join(root, 'commands'),
        plugins: join(root, 'plugins'),
        skills: join(root, 'skills'),
        mcp: join(root, 'mcp'),
        tools: join(root, 'tools'),
    };
}

describe('integrity: hash esperado sale del manifest bundleado', () => {
    it('getBundledExpectedHash devuelve el hash del manifest embebido en el paquete', () => {
        const expected = getBundledExpectedHash('skills', 'brainstorming');
        expect(expected).toMatch(/^[0-9a-f]{64}$/);
        // Debe coincidir con el árbol real bundleado — mismo origen, mismo hash.
        expect(expected).toBe(computeTreeHash(join(import.meta.dir, '..', 'assets', 'skills', 'brainstorming')));
    });

    it('getBundledExpectedHash devuelve null para un nombre fuera del bundle', () => {
        expect(getBundledExpectedHash('skills', 'skill-que-no-existe')).toBeNull();
    });

    it('assertBundledTreeHash falla cuando el árbol real no coincide con el bundleado', () => {
        expect(() => assertBundledTreeHash('skills', 'brainstorming', 'f'.repeat(64))).toThrow(
            /Tree hash inválido para skill "brainstorming"/
        );
    });

    it('assertBundledTreeHash no falla cuando el asset no está en el bundleado', () => {
        expect(() => assertBundledTreeHash('skills', 'skill-que-no-existe', 'f'.repeat(64))).not.toThrow();
    });

    it('installSkill ignora el sha256 del manifest remoto (regression: drift GitHub tag vs npm tarball)', async () => {
        const base = mkdtempSync(join(tmpdir(), 'ostacky-integrity-'));
        const paths = pathsFor(join(base, '.opencode'));
        try {
            const remoteItem = {
                name: 'brainstorming',
                file: 'assets/skills/brainstorming/',
                description: 'skill bundleada',
                version: '0.9.2',
                sha256: STALE_REMOTE_HASH,
            };
            const manifest: Manifest = {
                version: '0.9.2',
                tag: 'v0.9.2',
                repo: 'example/repo',
                agents: [],
                commands: [],
                skills: [remoteItem],
                mcpServers: [],
            };

            // El manifest remoto dice ac2f546 pero el bundle real es otro:
            // la instalación debe usar el hash bundleado y avanzar, no tirar abajo.
            await installSkill(remoteItem, manifest, paths);

            expect(existsSync(join(paths.skills, 'brainstorming', 'SKILL.md'))).toBe(true);
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });
});
