import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    hasLocalPluginInstall,
    pluginIdFor,
    resolveGlobalConfigDir,
} from '../assets/plugins/ostacky-controller/index.ts';

/**
 * OpenCode V2 dedupea plugins por `id` y conserva la PRIMERA ocurrencia en
 * orden de arranque (el config global se descubre antes que el del proyecto).
 * Con el mismo id, la copia global gana y la local queda
 * `failed: "Duplicate plugin ID"` — los gates dejan de aplicar sin avisar.
 *
 * Contrato: la copia global declara `ostacky-controller-global` (id distinto) y
 * su `setup` no registra nada si el proyecto tiene instalación local. Así la
 * precedencia es local-primero, igual que el resto de la config de OpenCode.
 */

let root = '';

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ostacky-scope-'));
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

describe('pluginIdFor', () => {
    const globalDir = () => join(root, 'xdg', 'opencode');

    it('la copia bajo el config dir global usa el id de scope global', () => {
        expect(pluginIdFor(join(globalDir(), 'plugins', 'ostacky-controller'), globalDir())).toBe(
            'ostacky-controller-global'
        );
    });

    it('el config dir global exacto también es global', () => {
        expect(pluginIdFor(globalDir(), globalDir())).toBe('ostacky-controller-global');
    });

    it('la copia del proyecto conserva el id local', () => {
        expect(pluginIdFor(join(root, 'proj', '.opencode', 'plugins', 'ostacky-controller'), globalDir())).toBe(
            'ostacky-controller'
        );
    });

    it('un dir hermano con prefijo parecido no cuenta como global', () => {
        expect(pluginIdFor(join(root, 'xdg', 'opencode2', 'plugins'), globalDir())).toBe('ostacky-controller');
    });

    it('sin dir propio (import.meta.url ilegible) cae al id local', () => {
        expect(pluginIdFor('', globalDir())).toBe('ostacky-controller');
    });
});

describe('resolveGlobalConfigDir', () => {
    it('OPENCODE_CONFIG_DIR gana sobre XDG (override total, sin sufijo)', () => {
        expect(
            resolveGlobalConfigDir({ env: { OPENCODE_CONFIG_DIR: '/explicit', XDG_CONFIG_HOME: '/x' }, home: '/h' })
        ).toBe('/explicit');
    });

    it('respeta XDG_CONFIG_HOME', () => {
        expect(resolveGlobalConfigDir({ env: { XDG_CONFIG_HOME: '/x' }, home: '/h' })).toBe(join('/x', 'opencode'));
    });

    it('win32 ignora APPDATA (OpenCode no lo usa para config)', () => {
        expect(resolveGlobalConfigDir({ env: { APPDATA: '/appdata' }, home: '/h' })).toBe(
            join('/h', '.config', 'opencode')
        );
    });

    it('sin XDG ni OPENCODE_CONFIG_DIR usa ~/.config', () => {
        expect(resolveGlobalConfigDir({ env: {}, home: '/h' })).toBe(join('/h', '.config', 'opencode'));
    });
});

describe('pluginIdFor', () => {
    it('detecta la copia global por prefijo del config dir', () => {
        expect(pluginIdFor(join('/h', '.config', 'opencode', 'plugins', 'ostacky-controller'), join('/h', '.config', 'opencode'))).toBe(
            'ostacky-controller-global'
        );
    });

    it('un proyecto cualquiera conserva el id local', () => {
        expect(pluginIdFor(join('/proj', '.opencode', 'plugins', 'ostacky-controller'), join('/h', '.config', 'opencode'))).toBe(
            'ostacky-controller'
        );
    });

    it('en win32 compara case-insensitive (los paths de Windows lo son)', () => {
        const plugin = join('/Users/A/.config/opencode/plugins/ostacky-controller');
        expect(pluginIdFor(plugin, '/users/a/.config/opencode', 'win32')).toBe('ostacky-controller-global');
        // en linux/darwin el mismo par NO matchea (case-sensitive)
        expect(pluginIdFor(plugin, '/users/a/.config/opencode', 'linux')).toBe('ostacky-controller');
    });
});

describe('hasLocalPluginInstall', () => {
    it('detecta plugins/ostacky-controller/index.ts', () => {
        mkdirSync(join(root, '.opencode', 'plugins', 'ostacky-controller'), { recursive: true });
        writeFileSync(join(root, '.opencode', 'plugins', 'ostacky-controller', 'index.ts'), 'x', 'utf-8');
        expect(hasLocalPluginInstall(root)).toBe(true);
    });

    it('detecta el layout singular plugin/ con index.js', () => {
        mkdirSync(join(root, '.opencode', 'plugin', 'ostacky-controller'), { recursive: true });
        writeFileSync(join(root, '.opencode', 'plugin', 'ostacky-controller', 'index.js'), 'x', 'utf-8');
        expect(hasLocalPluginInstall(root)).toBe(true);
    });

    it('sin instalación local devuelve false', () => {
        expect(hasLocalPluginInstall(root)).toBe(false);
    });

    it('no sube a ancestros: solo mira el location dir', () => {
        mkdirSync(join(root, '.opencode', 'plugins', 'ostacky-controller'), { recursive: true });
        writeFileSync(join(root, '.opencode', 'plugins', 'ostacky-controller', 'index.ts'), 'x', 'utf-8');
        const child = join(root, 'sub', 'proj');
        mkdirSync(child, { recursive: true });
        expect(hasLocalPluginInstall(child)).toBe(false);
    });
});

describe('plugin publicado', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'assets', 'plugins', 'ostacky-controller', 'index.ts'), 'utf-8');

    it('declara el id derivado del scope, no un literal fijo', () => {
        expect(source).toContain('id: PLUGIN_ID,');
        expect(source).not.toContain('id: "ostacky-controller",');
    });

    it('conserva el literal del id global para que el doctor lo detecte', () => {
        expect(source).toContain('"ostacky-controller-global"');
    });

    it('la copia global se retira si hay instalación local', () => {
        expect(source).toContain('if (IS_GLOBAL_COPY && hasLocalPluginInstall(directory)) return');
    });
});

describe('derivación real del id en runtime', () => {
    const srcDir = join(import.meta.dir, '..', 'assets', 'plugins', 'ostacky-controller');
    const files = ['index.ts', 'security.ts', 'tiered.ts', 'controller-core.ts'];

    function copyPlugin(to: string) {
        mkdirSync(to, { recursive: true });
        for (const f of files) {
            writeFileSync(join(to, f), readFileSync(join(srcDir, f), 'utf-8'), 'utf-8');
        }
        return pathToFileURL(join(to, 'index.ts')).href;
    }

    it('importada desde el config dir global declara el id global', async () => {
        const xdg = join(root, 'xdg');
        const href = copyPlugin(join(xdg, 'opencode', 'plugins', 'ostacky-controller'));
        const prev = process.env.XDG_CONFIG_HOME;
        process.env.XDG_CONFIG_HOME = xdg;
        try {
            const mod: any = await import(href);
            expect(mod.default.id).toBe('ostacky-controller-global');
        } finally {
            if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
            else process.env.XDG_CONFIG_HOME = prev;
        }
    });

    it('importada desde el proyecto conserva el id local', async () => {
        const href = copyPlugin(join(root, 'proj', '.opencode', 'plugins', 'ostacky-controller'));
        const mod: any = await import(href);
        expect(mod.default.id).toBe('ostacky-controller');
    });

    /**
     * El dedupe de OpenCode V2 es por `id`: si las dos copias declararan el
     * mismo, la local quedaría `failed: "Duplicate plugin ID"`. Acá se importan
     * las dos copias REALES en el mismo proceso y se comparan los ids.
     */
    it('las dos copias declaran ids distintos (no colisionan en el dedupe)', async () => {
        const xdg = join(root, 'xdg2');
        const prev = process.env.XDG_CONFIG_HOME;
        process.env.XDG_CONFIG_HOME = xdg;
        try {
            const globalMod: any = await import(copyPlugin(join(xdg, 'opencode', 'plugins', 'ostacky-controller')));
            const localMod: any = await import(
                copyPlugin(join(root, 'proj2', '.opencode', 'plugins', 'ostacky-controller'))
            );
            expect(globalMod.default.id).toBe('ostacky-controller-global');
            expect(localMod.default.id).toBe('ostacky-controller');
            expect(globalMod.default.id).not.toBe(localMod.default.id);
        } finally {
            if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
            else process.env.XDG_CONFIG_HOME = prev;
        }
    });

    /**
     * La copia global debe ser INERTE cuando el proyecto tiene instalación
     * local: `setup` no puede tocar `ctx` (si lo tocara, registraría hooks y
     * tools). El stub explota en cualquier acceso que no sea
     * `ctx.location.directory`.
     */
    function ctxBomb(directory: string): any {
        const boom = () => {
            throw new Error('ctx tocado');
        };
        return {
            location: { directory },
            get session() {
                return boom();
            },
            get tool() {
                return boom();
            },
            get event() {
                return boom();
            },
        };
    }

    it('con instalación local, la copia global no registra nada', async () => {
        const xdg = join(root, 'xdg3');
        const prev = process.env.XDG_CONFIG_HOME;
        process.env.XDG_CONFIG_HOME = xdg;
        try {
            const mod: any = await import(copyPlugin(join(xdg, 'opencode', 'plugins', 'ostacky-controller')));
            // proyecto con plugin local
            copyPlugin(join(root, 'proj3', '.opencode', 'plugins', 'ostacky-controller'));
            await expect(mod.default.setup(ctxBomb(join(root, 'proj3')))).resolves.toBeUndefined();
        } finally {
            if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
            else process.env.XDG_CONFIG_HOME = prev;
        }
    });

    it('sin instalación local, la copia global sí se registra (el guard es la diferencia)', async () => {
        const xdg = join(root, 'xdg4');
        const prev = process.env.XDG_CONFIG_HOME;
        process.env.XDG_CONFIG_HOME = xdg;
        try {
            const mod: any = await import(copyPlugin(join(xdg, 'opencode', 'plugins', 'ostacky-controller')));
            const proj = join(root, 'proj4');
            mkdirSync(proj, { recursive: true });
            await expect(mod.default.setup(ctxBomb(proj))).rejects.toThrow('ctx tocado');
        } finally {
            if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
            else process.env.XDG_CONFIG_HOME = prev;
        }
    });
});
