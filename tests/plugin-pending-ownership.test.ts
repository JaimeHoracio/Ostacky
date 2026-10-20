import { describe, expect, it } from 'bun:test';
import { isForeignPendingOwner, nextPendingGateCache } from '../assets/plugins/ostacky-controller/index.ts';

/**
 * El hard gate PENDING del plugin es global (un state file por proyecto).
 * Sin este predicado, la sesión B queda congelada por la confirmación pendiente
 * de la sesión A — y B además puede consumir/blockear esa decisión.
 */
describe('isForeignPendingOwner', () => {
    it('no trata como ajena una sesión sin identidad (event.sessionID ausente → "default")', () => {
        expect(isForeignPendingOwner({ state: 'EXECUTION_DECISION_PENDING', ownerSessionId: 'sess-A' }, 'default')).toBe(
            false
        );
    });

    it('no trata como ajena la request sin dueño (estado legacy)', () => {
        expect(isForeignPendingOwner({ state: 'EXECUTION_DECISION_PENDING', ownerSessionId: null }, 'sess-B')).toBe(false);
    });

    it('no trata como ajena la sesión dueña', () => {
        expect(isForeignPendingOwner({ state: 'EXECUTION_DECISION_PENDING', ownerSessionId: 'sess-A' }, 'sess-A')).toBe(
            false
        );
    });

    it('trata como ajena a otra sesión con dueño conocido', () => {
        expect(isForeignPendingOwner({ state: 'EXECUTION_DECISION_PENDING', ownerSessionId: 'sess-A' }, 'sess-B')).toBe(
            true
        );
    });
});

/**
 * Regresión: el cache del gate es por revisión, no por dueño. Si el paso de una
 * sesión ajena dejara un ALLOW cacheado, la sesión dueña lo reutilizaría en la
 * misma revisión y se saltearía su propia confirmación pendiente.
 */
describe('nextPendingGateCache', () => {
    it('no cachea ALLOW cuando el PENDING es de otra sesión', () => {
        expect(nextPendingGateCache(7, true)).toBeNull();
    });

    it('cachea ALLOW para el dueño o un estado no-PENDING', () => {
        expect(nextPendingGateCache(7, false)).toEqual({ revision: 7, result: 'ALLOW' });
    });
});
