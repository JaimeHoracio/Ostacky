import { homedir } from 'os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { sha256 } from './security.js';

/** Directorio raíz del cache: ~/.opencode/cache */
const CACHE_ROOT = join(homedir(), '.opencode', 'cache');

/**
 * Genera la ruta absoluta del archivo en cache.
 * Ejemplo: ~/.opencode/cache/JaimeHoracio__ostacky/v0.0.6/assets/agents/ostacky.md
 */
function cacheKey(repo: string, tag: string, filePath: string): string {
    const repoSlug = repo.replace('/', '__');
    return join(CACHE_ROOT, repoSlug, tag, filePath);
}

/**
 * Devuelve el contenido cacheado si existe y (opcionalmente) coincide el hash.
 * Retorna null si no hay cache o el hash no coincide.
 */
export function getCached(repo: string, tag: string, filePath: string, expectedHash?: string | null): string | null {
    const cachePath = cacheKey(repo, tag, filePath);
    if (!existsSync(cachePath)) return null;

    try {
        const content = readFileSync(cachePath, 'utf-8');
        // Si hay hash esperado, validamos la integridad del archivo cacheado
        if (expectedHash && sha256(content) !== expectedHash) return null;
        return content;
    } catch {
        return null;
    }
}

/**
 * Guarda contenido en cache. Crea los directorios necesarios.
 */
export function putCache(repo: string, tag: string, filePath: string, content: string): void {
    const cachePath = cacheKey(repo, tag, filePath);
    const dir = dirname(cachePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(cachePath, content, 'utf-8');
}
