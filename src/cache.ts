import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { sha256 } from './security.js';

/**
 * Returns the cache root directory for a given project.
 * Cache is project-local: <projectRoot>/.opencode/cache/
 */
export function getCacheRoot(projectRoot: string): string {
    return join(projectRoot, '.opencode', 'cache');
}

/**
 * Generates the absolute path for a cached file.
 * Example: <projectRoot>/.opencode/cache/ostacky/v0.7.0/assets/agents/ostacky.md
 */
function cacheKey(projectRoot: string, repo: string, tag: string, filePath: string): string {
    const repoSlug = repo.replace('/', '__');
    return join(getCacheRoot(projectRoot), repoSlug, tag, filePath);
}

/**
 * Returns cached content if it exists and (optionally) matches the hash.
 * Returns null if no cache or hash mismatch.
 */
export function getCached(
    projectRoot: string,
    repo: string,
    tag: string,
    filePath: string,
    expectedHash?: string | null
): string | null {
    const cachePath = cacheKey(projectRoot, repo, tag, filePath);
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
 * Saves content to cache. Creates necessary directories.
 */
export function putCache(projectRoot: string, repo: string, tag: string, filePath: string, content: string): void {
    const cachePath = cacheKey(projectRoot, repo, tag, filePath);
    const dir = dirname(cachePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(cachePath, content, 'utf-8');
}
