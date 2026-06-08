import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const LOCKFILE_NAME = 'ostacky-lock.json';

export interface LockfileItem {
    version: string;
    installedAt: string;
    sha256?: string;
}

export interface Lockfile {
    /** Versión del manifest en el momento de la instalación */
    version: string;
    /** Timestamp de la última escritura */
    lockedAt: string;
    /** Repositorio origen */
    repo: string;
    /** Tag de GitHub usado en la instalación */
    tag: string;
    /** Agentes instalados: nombre → metadata */
    agents: Record<string, LockfileItem>;
    /** Commands instalados: nombre → metadata */
    commands: Record<string, LockfileItem>;
    /** Skills instaladas: nombre → metadata */
    skills: Record<string, LockfileItem>;
}

export function getLockfilePath(opencodeRoot: string): string {
    return join(opencodeRoot, LOCKFILE_NAME);
}

/**
 * Lee el lockfile del directorio .opencode.
 * Retorna null si no existe o no es parseable.
 */
export function readLockfile(opencodeRoot: string): Lockfile | null {
    const lockPath = getLockfilePath(opencodeRoot);
    if (!existsSync(lockPath)) return null;
    try {
        return JSON.parse(readFileSync(lockPath, 'utf-8')) as Lockfile;
    } catch {
        return null;
    }
}

/**
 * Escribe el lockfile en el directorio .opencode.
 */
export function writeLockfile(opencodeRoot: string, lockfile: Lockfile): void {
    writeFileSync(getLockfilePath(opencodeRoot), JSON.stringify(lockfile, null, 2), 'utf-8');
}

/**
 * Retorna la versión instalada de un item, o null si no está en el lockfile.
 */
export function getInstalledVersion(
    lockfile: Lockfile | null,
    type: 'agents' | 'commands' | 'skills',
    name: string
): string | null {
    return lockfile?.[type]?.[name]?.version ?? null;
}

/**
 * Removes a single entry from the lockfile. If the entry does not exist,
 * this is a no-op. The lockfile is written back to disk.
 */
export function removeFromLockfile(opencodeRoot: string, type: 'agents' | 'commands' | 'skills', name: string): void {
    const lockfile = readLockfile(opencodeRoot);
    if (!lockfile) return;
    if (!lockfile[type]) return;
    if (!(name in lockfile[type])) return;
    delete lockfile[type][name];
    writeLockfile(opencodeRoot, lockfile);
}

/**
 * If the lockfile exists: resets agents/commands/skills to {} and updates
 * lockedAt, preserving the existing version/repo/tag.
 * If it doesn't exist: writes a fresh minimal lockfile.
 */
export function clearLockfile(opencodeRoot: string): void {
    const lockfile = readLockfile(opencodeRoot);
    if (!lockfile) {
        // Nothing to clear; write a fresh minimal lockfile.
        writeLockfile(opencodeRoot, {
            version: '0.0.2',
            lockedAt: new Date().toISOString(),
            repo: '',
            tag: '',
            agents: {},
            commands: {},
            skills: {},
        });
        return;
    }
    lockfile.agents = {};
    lockfile.commands = {};
    lockfile.skills = {};
    lockfile.lockedAt = new Date().toISOString();
    writeLockfile(opencodeRoot, lockfile);
}
