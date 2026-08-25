import { describe, it, expect } from 'bun:test';
import { getInstalledVersion, type Lockfile } from '../src/lockfile.js';

const mockLockfile: Lockfile = {
    version: '0.7.2',
    lockedAt: '2025-01-01T00:00:00.000Z',
    repo: 'JaimeHoracio/Ostacky',
    tag: 'v0.7.2',
    agents: {
        ostacky: {
            version: '0.7.2',
            installedAt: '2025-01-01T00:00:00.000Z',
            sha256: 'abc123',
        },
    },
    commands: {
        'install-stack': {
            version: '0.7.2',
            installedAt: '2025-01-01T00:00:00.000Z',
        },
    },
    skills: {},
    mcpServers: {},
};

describe('getInstalledVersion', () => {
    it('returns version for existing agent', () => {
        const v = getInstalledVersion(mockLockfile, 'agents', 'ostacky');
        expect(v).toBe('0.7.2');
    });

    it('returns version for existing command', () => {
        const v = getInstalledVersion(mockLockfile, 'commands', 'install-stack');
        expect(v).toBe('0.7.2');
    });

    it('returns null for missing item', () => {
        const v = getInstalledVersion(mockLockfile, 'agents', 'nonexistent');
        expect(v).toBeNull();
    });

    it('returns null for null lockfile', () => {
        const v = getInstalledVersion(null, 'agents', 'ostacky');
        expect(v).toBeNull();
    });

    it('returns null for empty type', () => {
        const v = getInstalledVersion(mockLockfile, 'skills', 'anything');
        expect(v).toBeNull();
    });

    it('returns null for mcpServers when none exist', () => {
        const v = getInstalledVersion(mockLockfile, 'mcpServers', 'anything');
        expect(v).toBeNull();
    });
});
