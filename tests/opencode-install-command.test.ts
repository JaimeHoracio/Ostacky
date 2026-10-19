import { describe, expect, it } from 'bun:test';
import { getOpencodeInstallCommand } from '../src/opencode.ts';

/**
 * Regresión: Ostacky exige OpenCode V2 (ver `ensureOpencodeInstalled`: `major < 2` → corte),
 * pero los hints de instalación apuntaban a la línea V1:
 *   - `https://opencode.ai/install` (sin `/v2`) sirve el instalador de V1
 *   - el paquete npm `opencode-ai` es V1 (`@opencode/cli` es V2)
 * Resultado: Ostacky ofrecía instalar OpenCode, instalaba V1, y en la re-verificación
 * cortaba con "OpenCode V1 detectado (…). Ostacky requiere OpenCode V2."
 *
 * Fuente de los comandos V2: https://opencode.ai/v2/docs
 */

const PLATFORMS = ['linux', 'darwin', 'win32'] as const;

function surface(platform: string) {
    const info = getOpencodeInstallCommand(platform);
    return { info, all: [info.display, ...(info.args ?? []), info.note ?? ''].join(' ') };
}

describe('getOpencodeInstallCommand — solo comandos de OpenCode V2', () => {
    for (const platform of PLATFORMS) {
        it(`${platform}: no menciona el paquete V1 ni el instalador sin /v2`, () => {
            const { all } = surface(platform);
            expect(all).not.toContain('opencode-ai');
            expect(all).not.toContain('opencode.ai/install');
            expect(all).not.toMatch(/anomalyco\/tap\/opencode(?!-v2)/);
        });
    }

    it('linux y darwin usan el instalador oficial de V2 (display + args ejecutados)', () => {
        for (const platform of ['linux', 'darwin'] as const) {
            const { info } = surface(platform);
            expect(info.display).toContain('https://opencode.ai/v2/install');
            expect(info.args.join(' ')).toContain('https://opencode.ai/v2/install');
            expect(info.command).toBe('bash');
        }
    });

    it('windows usa el paquete npm de V2 y se lo pasa a npm', () => {
        const { info } = surface('win32');
        expect(info.display).toBe('npm install -g @opencode/cli');
        expect(info.command).toBe('npm');
        expect(info.args).toEqual(['install', '-g', '@opencode/cli']);
    });

    it('las alternativas por brew usan el tap de V2', () => {
        expect(surface('darwin').all).toContain('anomalyco/tap/opencode-v2');
        expect(surface('linux').all).toContain('anomalyco/tap/opencode-v2');
    });

    it('linux ofrece bun con --trust (habilita el postinstall del binario nativo)', () => {
        expect(surface('linux').all).toContain('bun install -g --trust @opencode/cli');
    });
});
