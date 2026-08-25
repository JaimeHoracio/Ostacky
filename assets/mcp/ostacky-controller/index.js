#!/usr/bin/env node

/**
 * Ostacky Controller — MCP Server
 *
 * Máquina de estados persistida para Ostacky. Valida transiciones,
 * consume decisiones, autoriza side effects y persiste snapshots.
 *
 * Usage: node .opencode/mcp/ostacky-controller/index.js
 *
 * Environment:
 *   OSTACKY_STATE_PATH — Ruta al archivo de estado JSON (default: .opencode/ostacky-state.json)
 */

import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import {
    readFileSync,
    writeFileSync,
    renameSync,
    mkdirSync,
    readdirSync,
    unlinkSync,
    statSync,
    existsSync,
} from 'node:fs';
import { dirname, basename, join, resolve } from 'node:path';
import { writeFile as writeFileAsync, rename as renameAsync, mkdir as mkdirAsync } from 'node:fs/promises';

// T1: non-blocking wait — replaces busy-wait spins that froze the event loop
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Constants (Fase 5.5 — headroom generoso) ---
const MAX_TASKS = 100;
const MAX_SNAPSHOT_JSON_LENGTH = 50 * 1024;
const MAX_STATE_FILE_SIZE = 2 * 1024 * 1024;
const DEGRADED_THRESHOLD = 3; // consecutive failures before auto-degraded mode

// --- Transition table ---
const TRANSITIONS = {
    INTERPRETATION_PENDING: [
        { via: 'request_clarification', to: 'CLARIFICATION_PENDING' },
        { via: 'proceed_to_discovery', to: 'DISCOVERY' },
        { via: 'record_discovery', to: 'ROUTE_DECISION_PENDING' },
        { via: 'block', to: 'BLOCKED' },
    ],
    CLARIFICATION_PENDING: [
        { via: 'record_clarification', to: 'DISCOVERY' },
        { via: 'block', to: 'BLOCKED' },
        { via: 'abandon', to: 'BLOCKED' },
    ],
    DISCOVERY: [
        { via: 'record_discovery', to: 'LEVEL_RESOLVED' },
        { via: 'block', to: 'BLOCKED' },
        { via: 'abandon', to: 'BLOCKED' },
    ],
    LEVEL_RESOLVED: [
        { via: 'proceed_to_route', to: 'ROUTE_DECISION_PENDING' },
        { via: 'block', to: 'BLOCKED' },
    ],
    ROUTE_DECISION_PENDING: [
        { via: 'consume_route_decision', to: 'SPECIFICATION', choice: 'SPEC' },
        { via: 'consume_route_decision', to: 'EXECUTION_ANALYSIS', choice: 'DIRECT' },
        { via: 'block', to: 'BLOCKED' },
        { via: 'abandon', to: 'BLOCKED' },
    ],
    SPECIFICATION: [
        { via: 'spec_complete', to: 'EXECUTION_ANALYSIS' },
        { via: 'block', to: 'BLOCKED' },
        { via: 'abandon', to: 'BLOCKED' },
    ],
    EXECUTION_ANALYSIS: [
        { via: 'record_execution_analysis', to: 'EXECUTION_DECISION_PENDING' },
        { via: 'block', to: 'BLOCKED' },
        { via: 'abandon', to: 'BLOCKED' },
    ],
    EXECUTION_DECISION_PENDING: [
        { via: 'consume_execution_decision', to: 'EXECUTING_INLINE', mode: 'INLINE' },
        { via: 'consume_execution_decision', to: 'EXECUTING_SUBAGENTS', mode: 'SUBAGENT_DRIVEN' },
        { via: 'block', to: 'BLOCKED' },
        { via: 'abandon', to: 'BLOCKED' },
    ],
    EXECUTING_INLINE: [
        { via: 'implementation_complete', to: 'SYNC' },
        { via: 'block', to: 'BLOCKED' },
    ],
    EXECUTING_SUBAGENTS: [
        { via: 'implementation_complete', to: 'SYNC' },
        { via: 'block', to: 'BLOCKED' },
    ],
    BLOCKED: [
        { via: 'replan', to: 'INTERPRETATION_PENDING' },
        { via: 'abandon', to: 'DONE' },
    ],
    SYNC: [
        { via: 'sync_complete', to: 'DONE' },
        { via: 'block', to: 'BLOCKED' },
    ],
    DONE: [],
};

// --- O4: Pre-computed transition cache (O(1) lookup) ---
const ALLOWED_TRANSITIONS = Object.freeze(
    Object.fromEntries(
        Object.entries(TRANSITIONS).map(([state, transitions]) => [
            state,
            new Map(transitions.map((t) => [`${t.via}:${t.choice || t.mode || ''}`, t.to])),
        ])
    )
);

/**
 * Safe JSON.stringify that won't throw on circular references.
 *
 * Uses WeakSet (not Map/Set) so:
 * - Object references are tracked without preventing GC
 * - Nested non-cyclic objects are still serialized fully
 * - Symbol keys are silently dropped (JSON limitation, not a bug)
 * - Functions are dropped (JSON limitation)
 * - Returns "[Unstringifiable: ...]" on hard failures (BigInt, etc.)
 */
function safeJsonStringify(obj, pretty = false) {
    const seen = new WeakSet();
    try {
        return JSON.stringify(
            obj,
            (key, value) => {
                if (typeof value === 'object' && value !== null) {
                    if (seen.has(value)) return '[Circular]';
                    seen.add(value);
                }
                return value;
            },
            pretty ? 2 : undefined
        );
    } catch (e) {
        return `[Unstringifiable: ${e.message}]`;
    }
}

function log(event, data) {
    const ts = new Date().toISOString();
    const payload = data ? ` ${safeJsonStringify(data)}` : '';
    console.error(`[${ts}] ${event}${payload}`);
}

/**
 * Cleans up stale .tmp.* and .lock.* files from a previous crash — C3 fix: never delete active locks of another process.
 * Also handles orphaned .ostacky-handoff-compaction.json (only if ts>24h).
 */
function cleanupTmpFiles(statePath) {
    if (!statePath) return;
    const dir = dirname(statePath);
    const name = basename(statePath);
    const staleWindow = 15000;
    const handoffTtl = 24 * 60 * 60 * 1000;
    try {
        for (const entry of readdirSync(dir)) {
            const isTmp = entry.startsWith(name + '.tmp.');
            const isLock = entry.startsWith(name + '.lock');
            const isHandoff = entry === '.ostacky-handoff-compaction.json';
            if (!isTmp && !isLock && !isHandoff) continue;
            // C3: don't delete active lock of another process
            if (isLock) {
                try {
                    const pidPath = join(dir, name + '.lock.pid');
                    const tsPath = join(dir, name + '.lock.timestamp');
                    // If we are checking a lock file, verify liveness
                    let lockPid = null;
                    let lockTs = null;
                    try {
                        lockPid = readFileSync(pidPath, 'utf8').trim();
                    } catch {}
                    try {
                        lockTs = parseInt(readFileSync(tsPath, 'utf8').trim(), 10);
                    } catch {}
                    if (lockPid && lockTs && !Number.isNaN(lockTs)) {
                        const age = Date.now() - lockTs;
                        if (age < staleWindow && String(lockPid) !== String(process.pid)) {
                            continue; // active lock of another process — skip
                        }
                    }
                } catch {}
            }
            if (isHandoff) {
                try {
                    const handoffPath = join(dir, entry);
                    const raw = readFileSync(handoffPath, 'utf8');
                    const data = JSON.parse(raw);
                    const ts = data?.ts ?? data?.timestamp ?? 0;
                    if (ts && Date.now() - ts < handoffTtl) continue; // keep recent handoff
                } catch {
                    // If unreadable, treat as stale and delete
                }
            }
            try {
                unlinkSync(join(dir, entry));
            } catch {
                /* best-effort */
            }
        }
    } catch {
        /* directory may not exist yet */
    }
}

// --- O6: Fast fingerprint (mtime + size) ---
function fastFingerprint(filePath) {
    try {
        const stat = statSync(filePath);
        return `${stat.mtimeMs}-${stat.size}`;
    } catch {
        return null;
    }
}

const STATES = Object.freeze({
    INTERPRETATION_PENDING: 'INTERPRETATION_PENDING',
    CLARIFICATION_PENDING: 'CLARIFICATION_PENDING',
    DISCOVERY: 'DISCOVERY',
    LEVEL_RESOLVED: 'LEVEL_RESOLVED',
    ROUTE_DECISION_PENDING: 'ROUTE_DECISION_PENDING',
    SPECIFICATION: 'SPECIFICATION',
    EXECUTION_ANALYSIS: 'EXECUTION_ANALYSIS',
    EXECUTION_DECISION_PENDING: 'EXECUTION_DECISION_PENDING',
    EXECUTING_INLINE: 'EXECUTING_INLINE',
    EXECUTING_SUBAGENTS: 'EXECUTING_SUBAGENTS',
    SYNC: 'SYNC',
    DONE: 'DONE',
    BLOCKED: 'BLOCKED',
});

const DEFAULT_STATE = Object.freeze({
    state: STATES.INTERPRETATION_PENDING,
    revision: 0,
    requestId: null,
    changeId: null,
    routeDecisionId: null,
    routeChoice: null,
    level: null,
    executionDecisionId: null,
    executionMode: null,
    snapshots: { codegraph: null, execution: null },
    tasks: {},
    fileFingerprints: {},
    error: null,
    lastHandoff: null, // B2: { ts, summary, nextSteps, pendingTasks } | null
    expectedTasks: null, // C2: array of taskIds expected for this run (set via record_execution_analysis or set_expected_tasks)
    expectedTaskCount: null, // C2: count fallback when IDs not available
    auditSeq: 0, // C1: persistent seq for audit IDs
});

class OstackyController {
    #statePath;
    #state;
    #loaded;
    #degraded = false;
    #consecutiveFailures = 0;
    #auditBuffer = [];
    #lockPath;
    #lockPidPath;
    #lockHeartbeatPath;
    #lockMaxAttempts = 5; // C1: 10→5 with jitter, overridable via opts for fast tests

    constructor(opts = {}) {
        this.#statePath = opts.statePath;
        this.#lockPath = opts.statePath ? opts.statePath + '.lock' : null;
        this.#lockPidPath = opts.statePath ? opts.statePath + '.lock.pid' : null;
        this.#lockHeartbeatPath = opts.statePath ? opts.statePath + '.lock.timestamp' : null;
        if (typeof opts.lockMaxAttempts === 'number' && opts.lockMaxAttempts > 0) {
            this.#lockMaxAttempts = opts.lockMaxAttempts;
        }
        if (opts.initialState) {
            this.#state = { ...DEFAULT_STATE, ...opts.initialState };
            this.#loaded = true;
        } else {
            this.#state = null;
            this.#loaded = false;
        }
    }

    /**
     * Returns whether the controller is in degraded mode.
     */
    get degraded() {
        return this.#degraded;
    }

    /**
     * Validates that a parsed state object has the required fields and valid values.
     * Returns null if valid, or an error message if invalid.
     */
    #validateState(parsed) {
        if (typeof parsed !== 'object' || parsed === null) return 'State is not an object';
        if (typeof parsed.state !== 'string') return 'Missing or invalid "state" field';
        if (!STATES[parsed.state]) return `Unknown state: "${parsed.state}"`;
        if (typeof parsed.revision !== 'number') return 'Missing or invalid "revision" field';
        if (parsed.revision < 0) return `Invalid revision: ${parsed.revision}`;
        return null; // valid
    }

    // --- 3.4: State file locking (C1 fix: check stale BEFORE write, atomic wx, jitter, 15s stale, 1s timeout) ---
    async #acquireLock() {
        if (!this.#lockPath) return true;
        const maxAttempts = this.#lockMaxAttempts;
        const lockTimeout = 1000;
        const staleWindow = 15000;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                // Check existing lock BEFORE overwriting — corrects mutual-exclusion bug
                try {
                    const lockContent = readFileSync(this.#lockHeartbeatPath, 'utf8');
                    const lockAge = Date.now() - parseInt(lockContent, 10);
                    if (!Number.isNaN(lockAge) && lockAge < staleWindow) {
                        const base = Math.min(lockTimeout, 100 * Math.pow(2, attempt));
                        const jitter = Math.floor(Math.random() * 200) - 100;
                        const waitMs = Math.max(0, base + jitter);
                        if (waitMs > 0) await sleep(waitMs);
                        continue;
                    }
                    if (!Number.isNaN(lockAge) && lockAge >= staleWindow) {
                        try {
                            const lockPid = readFileSync(this.#lockPidPath, 'utf8').trim();
                            try {
                                process.kill(parseInt(lockPid, 10), 0);
                                // PID alive but stale beyond window — force release
                            } catch {
                                // PID dead — force release
                            }
                        } catch {}
                        this.#releaseLock();
                    }
                } catch {
                    // No heartbeat file — try to acquire
                }
                // Atomic acquire with wx — fails if another process won the race
                try {
                    writeFileSync(this.#lockPidPath, String(process.pid), { encoding: 'utf8', flag: 'wx' });
                } catch (e) {
                    if (e && e.code === 'EEXIST') {
                        const base = Math.min(lockTimeout, 100 * Math.pow(2, attempt));
                        const jitter = Math.floor(Math.random() * 200) - 100;
                        const waitMs = Math.max(0, base + jitter);
                        if (waitMs > 0) await sleep(waitMs);
                        continue;
                    }
                    throw e;
                }
                writeFileSync(this.#lockHeartbeatPath, String(Date.now()), 'utf8');
                return true;
            } catch {
                const base = Math.min(lockTimeout, 100 * Math.pow(2, attempt));
                const jitter = Math.floor(Math.random() * 200) - 100;
                const waitMs = Math.max(0, base + jitter);
                if (waitMs > 0) await sleep(waitMs);
            }
        }
        log('warn:lock_acquire_failed', { attempts: maxAttempts });
        return false;
    }

    #releaseLock() {
        if (!this.#lockPath) return;
        try {
            unlinkSync(this.#lockPidPath);
        } catch {
            /* best-effort */
        }
        try {
            unlinkSync(this.#lockHeartbeatPath);
        } catch {
            /* best-effort */
        }
    }

    #heartbeatLock() {
        if (!this.#lockHeartbeatPath) return;
        try {
            writeFileSync(this.#lockHeartbeatPath, String(Date.now()), 'utf8');
        } catch {
            /* best-effort */
        }
    }

    #load() {
        if (this.#loaded) return;
        if (!this.#statePath) {
            this.#state = { ...DEFAULT_STATE };
            this.#loaded = true;
            return;
        }
        // Try primary state file
        try {
            const raw = readFileSync(this.#statePath, 'utf8');
            if (raw.length > MAX_STATE_FILE_SIZE) throw new Error(`State file too large: ${raw.length} bytes`);
            const parsed = JSON.parse(raw);
            const validationError = this.#validateState(parsed);
            if (validationError) throw new Error(`State validation failed: ${validationError}`);
            this.#state = { ...DEFAULT_STATE, ...parsed };
            this.#loaded = true;
            return;
        } catch (err) {
            log('warn:load_primary_failed', { error: err.message });
        }
        // Fallback: try .backup
        const backupPath = this.#statePath + '.backup';
        try {
            const raw = readFileSync(backupPath, 'utf8');
            if (raw.length > MAX_STATE_FILE_SIZE) throw new Error(`Backup too large: ${raw.length} bytes`);
            const parsed = JSON.parse(raw);
            const validationError = this.#validateState(parsed);
            if (validationError) throw new Error(`Backup validation failed: ${validationError}`);
            this.#state = { ...DEFAULT_STATE, ...parsed, error: 'State restored from backup' };
            log('warn:state_restored_from_backup');
            this.#loaded = true;
            return;
        } catch (backupErr) {
            // No backup either — set error state instead of silent reset
            this.#state = {
                ...DEFAULT_STATE,
                error: `State file corrupt: ${backupErr.message}. No backup available. State reset to default.`,
            };
            log('warn:state_reset', { error: backupErr.message });
        }
        this.#loaded = true;
    }

    async #persist() {
        if (!this.#statePath) return;

        const dir = dirname(this.#statePath);
        try {
            await mkdirAsync(dir, { recursive: true });
        } catch (err) {
            // mkdir failures also count toward degraded mode
            this.#consecutiveFailures++;
            log('error:persist_mkdir_failed', { consecutive: this.#consecutiveFailures, error: err.message });
            if (this.#consecutiveFailures >= DEGRADED_THRESHOLD && !this.#degraded) {
                this.#enterDegradedMode(`mkdir_failures: ${this.#consecutiveFailures} consecutive: ${err.message}`);
            }
            throw err;
        }

        try {
            // 3.4: Acquire lock before writing
            const lockAcquired = await this.#acquireLock();
            if (!lockAcquired) {
                log('warn:persist_skipped_lock', { state: this.#state.state });
                throw new Error('Could not acquire state file lock');
            }

            let serialized = safeJsonStringify(this.#state, true);
            if (serialized.length > MAX_STATE_FILE_SIZE) {
                log('warn:state_oversized', { size: serialized.length });
                const trimmed = { ...this.#state, snapshots: { codegraph: null, execution: null } };
                serialized = safeJsonStringify(trimmed, true);
                if (serialized.length > MAX_STATE_FILE_SIZE) {
                    log('error:state_too_large_even_after_trim');
                    return;
                }
                this.#state.snapshots = { codegraph: null, execution: null };
            }
            const tmp = this.#statePath + '.tmp.' + process.pid;
            await writeFileAsync(tmp, serialized, 'utf8');
            await renameAsync(tmp, this.#statePath);
            try {
                const backupTmp = this.#statePath + '.backup.tmp.' + process.pid;
                await writeFileAsync(backupTmp, serialized, 'utf8');
                await renameAsync(backupTmp, this.#statePath + '.backup');
            } catch {
                /* backup is best-effort */
            }
            // B1: persist success → reset failure counter
            if (this.#consecutiveFailures > 0) {
                log('info:persist_recovered', { after: this.#consecutiveFailures });
            }
            this.#consecutiveFailures = 0;
        } catch (err) {
            // B1: persist failure → increment counter, auto-degrade if threshold reached
            this.#consecutiveFailures++;
            log('error:persist_failed', { consecutive: this.#consecutiveFailures, error: err.message });
            if (this.#consecutiveFailures >= DEGRADED_THRESHOLD && !this.#degraded) {
                this.#enterDegradedMode(
                    `persistence_failures: ${this.#consecutiveFailures} consecutive persists: ${err.message}`
                );
            }
            throw err;
        } finally {
            this.#releaseLock();
        }
    }

    /**
     * Trims old completed tasks when we exceed MAX_TASKS.
     *
     * Invariant: entries in `state.tasks` are kept sorted by `completedAt` descending
     * (most recent first) as a side-effect of insertion order. We slice(0, MAX_TASKS)
     * to keep the newest MAX_TASKS entries and discard older ones.
     */

    #trimTasks() {
        if (!this.#state.tasks) return;
        const entries = Object.entries(this.#state.tasks);
        if (entries.length <= MAX_TASKS) return;
        // Sort by completedAt (desc), keep newest MAX_TASKS
        entries.sort((a, b) => {
            const da = a[1].completedAt || '';
            const db = b[1].completedAt || '';
            return db.localeCompare(da);
        });
        const trimmed = Object.fromEntries(entries.slice(0, MAX_TASKS));
        this.#state.tasks = trimmed;
        log('warn:tasks_trimmed', { before: entries.length, after: MAX_TASKS });
    }

    async #transition(to, changes = {}) {
        this.#state.revision++;
        this.#state.state = to;
        Object.assign(this.#state, changes);
        await this.#persist();
    }

    // --- O4: O(1) transition lookup via pre-computed cache ---
    #isAllowedTransition(from, via, choiceOrMode) {
        const key = `${via}:${choiceOrMode || ''}`;
        return ALLOWED_TRANSITIONS[from]?.get(key) || null;
    }

    // --- O5: Batched audit trail (C1: persistent ids + WARN force-flush) ---
    async #audit(phase, decision, reasoning) {
        const id = `aud-${Date.now()}-${this.#state.auditSeq++}`;
        this.#auditBuffer.push({
            id,
            ts: Date.now(),
            phase,
            decision,
            reasoning: reasoning ? String(reasoning).slice(0, 300) : undefined,
        });
        const isWarn = phase === 'WARN';
        if (this.#auditBuffer.length >= 10 || phase === 'DONE' || isWarn) {
            await this.#flushAudit(isWarn);
        }
    }

    async #flushAudit(forcePersist = false) {
        if (this.#auditBuffer.length === 0) return;
        if (!this.#state.audit) this.#state.audit = [];
        for (const e of this.#auditBuffer) {
            if (!e.id) e.id = `aud-${e.ts}-${this.#state.auditSeq++}`;
            if (e.reasoning && e.reasoning.length > 300) e.reasoning = e.reasoning.slice(0, 300);
        }
        this.#state.audit.push(...this.#auditBuffer);
        if (this.#state.audit.length > 100) {
            this.#state.audit = this.#state.audit.slice(-100);
        }
        this.#auditBuffer = [];
        // O1: Skip persist for trivial Level 0, but WARN always persists (forcePersist)
        if (
            !forcePersist &&
            this.#state.level === '0' &&
            this.#state.state !== 'DONE' &&
            this.#state.state !== 'BLOCKED'
        ) {
            return;
        }
        await this.#persist();
    }

    // --- 3.5: Enriched error with available transitions ---
    #makeError(message, attemptedTransition) {
        const available = (TRANSITIONS[this.#state?.state] || []).map((t) => {
            let desc = t.via;
            if (t.choice) desc += ` (choice=${t.choice})`;
            if (t.mode) desc += ` (mode=${t.mode})`;
            return desc;
        });
        return {
            error: message,
            current_state: this.#state?.state || 'UNKNOWN',
            attempted_transition: attemptedTransition || null,
            available_transitions: available,
            suggestion: this.#suggestRecovery(this.#state?.state, attemptedTransition),
            timestamp: new Date().toISOString(),
        };
    }

    #suggestRecovery(state, transition) {
        const suggestions = {
            INTERPRETATION_PENDING: 'Call start_request or proceed_to_discovery first.',
            CLARIFICATION_PENDING: 'Answer the clarification question, then call record_clarification.',
            DISCOVERY: 'Call record_discovery with a level classification.',
            LEVEL_RESOLVED: 'Call proceed_to_route to move to route decision.',
            ROUTE_DECISION_PENDING: 'Call consume_route_decision with SPEC or DIRECT.',
            SPECIFICATION: 'Call spec_complete when specification is done.',
            EXECUTION_ANALYSIS: 'Call record_execution_analysis with a snapshot.',
            EXECUTION_DECISION_PENDING: 'Call consume_execution_decision with INLINE or SUBAGENT_DRIVEN.',
            EXECUTING_INLINE: 'Call implementation_complete when done.',
            EXECUTING_SUBAGENTS: 'Call implementation_complete when done.',
            BLOCKED: 'Call replan to restart, or abandon to stop.',
            SYNC: 'Call sync_complete to finish.',
            DONE: 'Session complete. Call start_request for a new session.',
        };
        return suggestions[state] || `Unexpected state: ${state}`;
    }

    // --- 3.3: Degraded mode ---
    #enterDegradedMode(reason) {
        this.#degraded = true;
        log('degraded_mode_activated', { reason, state: this.#state?.state });
    }

    #exitDegradedMode() {
        if (!this.#degraded) return;
        this.#degraded = false;
        this.#consecutiveFailures = 0;
        log('degraded_mode_exited', { state: this.#state?.state });
    }

    // --- Core transitions ---

    async startRequest({ requestId, changeId } = {}) {
        this.#load();
        if (this.#state.state === 'INTERPRETATION_PENDING' && !requestId) {
            return { state: this.#state.state, revision: this.#state.revision, requestId: this.#state.requestId };
        }
        await this.#transition('INTERPRETATION_PENDING', {
            requestId: requestId || 'req-' + Date.now(),
            changeId: changeId || null,
            routeDecisionId: null,
            routeChoice: null,
            executionDecisionId: null,
            executionMode: null,
            snapshots: { codegraph: null, execution: null },
            tasks: {},
            fileFingerprints: {},
            expectedTasks: null,
            expectedTaskCount: null,
            error: null,
        });
        await this.#audit('INTERPRETATION_PENDING', 'start_request', `requestId=${this.#state.requestId}`);
        return { state: this.#state.state, revision: this.#state.revision, requestId: this.#state.requestId };
    }

    async requestClarification({ question } = {}) {
        this.#load();
        const to = this.#isAllowedTransition(this.#state.state, 'request_clarification');
        if (!to)
            return this.#makeError(
                `Cannot request clarification from state ${this.#state.state}`,
                'request_clarification'
            );
        await this.#transition(to, { error: question ? `Clarification: ${question}` : null });
        await this.#audit('CLARIFICATION_PENDING', 'request_clarification', question || 'no question');
        return { state: this.#state.state, revision: this.#state.revision };
    }

    async recordClarification() {
        this.#load();
        const to = this.#isAllowedTransition(this.#state.state, 'record_clarification');
        if (!to)
            return this.#makeError(
                `Cannot record clarification from state ${this.#state.state}`,
                'record_clarification'
            );
        await this.#transition(to, { error: null });
        await this.#audit('DISCOVERY', 'record_clarification');
        return { state: this.#state.state, revision: this.#state.revision };
    }

    // --- O3: Compressed CodeGraph snapshots ---
    #compressCodegraphSnapshot(fullResult) {
        if (!fullResult || typeof fullResult !== 'object') return fullResult;
        // If it's already compressed (has our marker), return as-is
        if (fullResult._compressed) return fullResult;
        return {
            _compressed: true,
            symbols: (fullResult.symbols || []).map((s) => ({
                name: s.name,
                kind: s.kind,
                file: s.file,
            })),
            blastRadius: fullResult.blastRadius || null,
            fileCount: (fullResult.files || []).length,
            callPaths: fullResult.callPaths?.map((p) => p.map((s) => s.name || s)) || null,
            timestamp: Date.now(),
            // Intentionally NOT including: fullResult.source (too large)
        };
    }

    async recordDiscovery({ level, routeDecisionId, snapshot } = {}) {
        this.#load();
        const to = this.#isAllowedTransition(this.#state.state, 'record_discovery');
        if (!to) return this.#makeError(`Cannot record discovery from state ${this.#state.state}`, 'record_discovery');

        // C2/H3: validate evidence BEFORE compress — _compressed is NOT valid evidence
        const hasEvidence =
            snapshot && !snapshot._compressed && Array.isArray(snapshot.symbols) && snapshot.symbols.length > 0;
        const isTrivial = level === '0';

        // O3: Compress snapshot before persisting
        const compressedSnapshot = snapshot
            ? this.#compressCodegraphSnapshot(snapshot)
            : this.#state.snapshots.codegraph;
        const snapshotJson = compressedSnapshot ? safeJsonStringify(compressedSnapshot) : '';
        if (snapshotJson.length > MAX_SNAPSHOT_JSON_LENGTH) {
            return this.#makeError(
                `Snapshot exceeds maximum size of ${MAX_SNAPSHOT_JSON_LENGTH} bytes (compressed: ${snapshotJson.length})`,
                'record_discovery'
            );
        }

        const defaultChoice = level === '1+' ? 'SPEC' : 'DIRECT';
        await this.#transition(to, {
            routeDecisionId: routeDecisionId || 'route-' + Date.now(),
            routeChoice: defaultChoice, // O2: persist default suggested choice
            level, // O1: persist level for conditional persistence
            snapshots: { ...this.#state.snapshots, codegraph: compressedSnapshot },
        });
        await this.#audit('LEVEL_RESOLVED', 'record_discovery', `level=${level}, default=${defaultChoice}`);
        // C2: warning if no evidence and not degraded and not trivial
        if (!hasEvidence && !this.#degraded && !isTrivial) {
            const auditId = `aud-${Date.now()}-${this.#state.auditSeq}`;
            log('warn:discovery_without_codegraph', { level, auditId });
            await this.#audit('WARN', 'discovery_without_codegraph', `level=${level} symbols missing`);
            // auditId is the last pushed id
            const lastAudit = this.#state.audit?.[this.#state.audit.length - 1];
            return {
                state: this.#state.state,
                revision: this.#state.revision,
                level,
                routeDecisionId: this.#state.routeDecisionId,
                defaultChoice,
                warning: 'discovery without codegraph evidence',
                auditId: lastAudit?.id || auditId,
            };
        }
        return {
            state: this.#state.state,
            revision: this.#state.revision,
            level,
            routeDecisionId: this.#state.routeDecisionId,
            defaultChoice,
        };
    }

    async proceedToRoute() {
        this.#load();
        const to = this.#isAllowedTransition(this.#state.state, 'proceed_to_route');
        if (!to) return this.#makeError(`Cannot proceed to route from state ${this.#state.state}`, 'proceed_to_route');
        await this.#transition(to);
        await this.#audit('ROUTE_DECISION_PENDING', 'proceed_to_route');
        return { state: this.#state.state, revision: this.#state.revision };
    }

    async abandon({ reason } = {}) {
        this.#load();
        const to = this.#isAllowedTransition(this.#state.state, 'abandon');
        if (!to) return this.#makeError(`Cannot abandon from state ${this.#state.state}`, 'abandon');
        await this.#transition(to, { error: reason || 'Abandoned' });
        await this.#audit('BLOCKED/DONE', 'abandon', reason || 'no reason');
        return { state: this.#state.state, revision: this.#state.revision };
    }

    async consumeRouteDecision({ decisionId, choice } = {}) {
        this.#load();
        if (this.#state.state !== 'ROUTE_DECISION_PENDING') {
            return this.#makeError(
                `Cannot consume route decision from state ${this.#state.state}`,
                'consume_route_decision'
            );
        }
        if (this.#state.routeDecisionId !== decisionId)
            return this.#makeError('Decision ID mismatch', 'consume_route_decision');
        const to = this.#isAllowedTransition(this.#state.state, 'consume_route_decision', choice);
        if (!to)
            return this.#makeError(`Route ${choice} not allowed from ${this.#state.state}`, 'consume_route_decision');
        await this.#transition(to, { routeChoice: choice });
        await this.#audit(to, 'consume_route_decision', `choice=${choice}`);
        return { state: this.#state.state, revision: this.#state.revision, routeChoice: choice };
    }

    async specComplete() {
        this.#load();
        const to = this.#isAllowedTransition(this.#state.state, 'spec_complete');
        if (!to) return this.#makeError(`Cannot complete spec from state ${this.#state.state}`, 'spec_complete');
        await this.#transition(to);
        await this.#audit('EXECUTION_ANALYSIS', 'spec_complete');
        return { state: this.#state.state, revision: this.#state.revision };
    }

    async recordExecutionAnalysis({ executionDecisionId, snapshot } = {}) {
        this.#load();
        const to = this.#isAllowedTransition(this.#state.state, 'record_execution_analysis');
        if (!to)
            return this.#makeError(
                `Cannot record execution analysis from state ${this.#state.state}`,
                'record_execution_analysis'
            );
        if (snapshot && safeJsonStringify(snapshot).length > MAX_SNAPSHOT_JSON_LENGTH) {
            return this.#makeError(
                `Snapshot exceeds maximum size of ${MAX_SNAPSHOT_JSON_LENGTH} bytes`,
                'record_execution_analysis'
            );
        }
        // C2: strict contract — recommendation + reasons required
        if (snapshot && (!snapshot.recommendation || !snapshot.reasons)) {
            return this.#makeError('Snapshot missing recommendation/reasons', 'record_execution_analysis');
        }
        // C2: capture expected tasks for gate
        const expectedTasks = snapshot?.expectedTaskIds || snapshot?.taskIds || null;
        const expectedTaskCount = snapshot?.taskCount ?? (Array.isArray(expectedTasks) ? expectedTasks.length : null);
        await this.#transition(to, {
            executionDecisionId: executionDecisionId || 'exec-' + Date.now(),
            executionMode: null,
            snapshots: { ...this.#state.snapshots, execution: snapshot || null },
            expectedTasks: Array.isArray(expectedTasks) ? expectedTasks : null,
            expectedTaskCount: typeof expectedTaskCount === 'number' ? expectedTaskCount : null,
        });
        await this.#audit('EXECUTION_DECISION_PENDING', 'record_execution_analysis');
        // C2: warning if missing codegraphUsed+recommendation and not degraded
        const hasEvidence =
            snapshot &&
            Array.isArray(snapshot.codegraphUsed) &&
            snapshot.codegraphUsed.length > 0 &&
            snapshot.recommendation != null;
        if (snapshot && !hasEvidence && !this.#degraded) {
            const auditId = `aud-${Date.now()}-${this.#state.auditSeq}`;
            log('warn:execution_without_codegraph', { auditId });
            await this.#audit('WARN', 'execution_without_codegraph', 'codegraphUsed/recommendation missing');
            const lastAudit = this.#state.audit?.[this.#state.audit.length - 1];
            return {
                state: this.#state.state,
                revision: this.#state.revision,
                executionDecisionId: this.#state.executionDecisionId,
                warning: 'execution analysis without execution-mode-evaluation',
                auditId: lastAudit?.id || auditId,
            };
        }
        return {
            state: this.#state.state,
            revision: this.#state.revision,
            executionDecisionId: this.#state.executionDecisionId,
        };
    }

    async consumeExecutionDecision({ decisionId, mode } = {}) {
        this.#load();
        if (this.#state.state !== 'EXECUTION_DECISION_PENDING') {
            return this.#makeError(
                `Cannot consume execution decision from state ${this.#state.state}`,
                'consume_execution_decision'
            );
        }
        if (this.#state.executionDecisionId !== decisionId)
            return this.#makeError('Decision ID mismatch', 'consume_execution_decision');
        const to = this.#isAllowedTransition(this.#state.state, 'consume_execution_decision', mode);
        if (!to)
            return this.#makeError(`Mode ${mode} not allowed from ${this.#state.state}`, 'consume_execution_decision');
        await this.#transition(to, { executionMode: mode });
        await this.#audit(to, 'consume_execution_decision', `mode=${mode}`);
        return { state: this.#state.state, revision: this.#state.revision, executionMode: mode };
    }

    async implementationComplete({ force } = {}) {
        this.#load();
        const to = this.#isAllowedTransition(this.#state.state, 'implementation_complete');
        if (!to)
            return this.#makeError(
                `Cannot complete implementation from state ${this.#state.state}`,
                'implementation_complete'
            );
        // C2 gate: check expectedTasks vs completed — do NOT transition if pending and not forced
        let pending = [];
        if (Array.isArray(this.#state.expectedTasks) && this.#state.expectedTasks.length > 0) {
            pending = this.#state.expectedTasks.filter(
                (id) => !this.#state.tasks[id] || this.#state.tasks[id].status !== 'COMPLETED'
            );
        } else if (typeof this.#state.expectedTaskCount === 'number') {
            const completed = Object.values(this.#state.tasks).filter((t) => t.status === 'COMPLETED').length;
            if (completed < this.#state.expectedTaskCount)
                pending = [`${completed}/${this.#state.expectedTaskCount} completed`];
        }
        // T3: also block on stale fingerprints-vs-disk
        let staleFiles = [];
        try {
            for (const [taskId, info] of Object.entries(this.#state.tasks || {})) {
                if (info.status !== 'COMPLETED' || !info.filePath || !info.fileHash) continue;
                const current = fastFingerprint(info.filePath);
                if (!current) staleFiles.push(`${taskId}:${info.filePath} (missing)`);
                else if (current !== info.fileHash) staleFiles.push(`${taskId}:${info.filePath} (stale fingerprint)`);
            }
            for (const [fp, stored] of Object.entries(this.#state.fileFingerprints || {})) {
                if (staleFiles.some((s) => s.includes(fp))) continue;
                const cur = fastFingerprint(fp);
                if (!cur) staleFiles.push(`${fp} (missing)`);
                else if (cur !== stored) staleFiles.push(`${fp} (stale fingerprint)`);
            }
        } catch {}
        const hasBlocking = pending.length > 0 || staleFiles.length > 0;
        if (hasBlocking && !force) {
            return {
                error: staleFiles.length ? 'stale fingerprints' : 'tasks incomplete',
                pending,
                staleFiles: staleFiles.length ? staleFiles : undefined,
                current_state: this.#state.state,
                attempted_transition: 'implementation_complete',
                suggestion:
                    'Complete pending tasks via complete_task or retry with {force:true} after explicit user confirmation',
            };
        }
        if (hasBlocking && force) {
            const all = [...pending, ...staleFiles].join(',');
            await this.#audit('FORCE', 'implementation_complete', `forced with pending: ${all}`);
        }
        await this.#transition(to);
        await this.#audit('SYNC', 'implementation_complete');
        return {
            state: this.#state.state,
            revision: this.#state.revision,
            forced: !!force,
            pending: pending.length ? pending : undefined,
        };
    }

    async syncComplete() {
        this.#load();
        const to = this.#isAllowedTransition(this.#state.state, 'sync_complete');
        if (!to) return this.#makeError(`Cannot complete sync from state ${this.#state.state}`, 'sync_complete');
        await this.#transition(to);
        await this.#audit('DONE', 'sync_complete');
        // Flush remaining audit entries
        await this.#flushAudit();
        return { state: this.#state.state, revision: this.#state.revision };
    }

    async block({ reason } = {}) {
        this.#load();
        const to = this.#isAllowedTransition(this.#state.state, 'block');
        if (!to) return this.#makeError(`Cannot block from state ${this.#state.state}`, 'block');
        await this.#transition(to, { error: reason || 'Blocked' });
        await this.#audit('BLOCKED', 'block', reason || 'no reason');
        return { state: this.#state.state, revision: this.#state.revision };
    }

    async replan({ reason } = {}) {
        this.#load();
        const to = this.#isAllowedTransition(this.#state.state, 'replan');
        if (!to) return this.#makeError(`Cannot replan from state ${this.#state.state}`, 'replan');
        await this.#transition(to, {
            error: reason || null,
            routeDecisionId: null,
            routeChoice: null,
            executionDecisionId: null,
            executionMode: null,
            snapshots: { codegraph: null, execution: null },
            tasks: {},
            fileFingerprints: {},
            expectedTasks: null,
            expectedTaskCount: null,
        });
        await this.#audit('INTERPRETATION_PENDING', 'replan', reason || 'no reason');
        return { state: this.#state.state, revision: this.#state.revision };
    }

    // --- C2: Expected tasks gate (controller as source of truth) ---
    async setExpectedTasks({ taskIds, taskCount } = {}) {
        this.#load();
        if (Array.isArray(taskIds) && taskIds.length > 0) {
            this.#state.expectedTasks = [...taskIds];
            this.#state.expectedTaskCount = taskIds.length;
        } else if (typeof taskCount === 'number' && taskCount > 0) {
            this.#state.expectedTasks = null;
            this.#state.expectedTaskCount = taskCount;
        } else {
            return { error: 'taskIds (array) or taskCount (number) required' };
        }
        await this.#persist();
        await this.#audit(
            'EXECUTING',
            'set_expected_tasks',
            `expected=${this.#state.expectedTaskCount ?? this.#state.expectedTasks?.length}`
        );
        return { ok: true, expectedTasks: this.#state.expectedTasks, expectedTaskCount: this.#state.expectedTaskCount };
    }

    async verifyIntegrity() {
        this.#load();
        let pending = [];
        if (Array.isArray(this.#state.expectedTasks) && this.#state.expectedTasks.length > 0) {
            pending = this.#state.expectedTasks.filter(
                (id) => !this.#state.tasks[id] || this.#state.tasks[id].status !== 'COMPLETED'
            );
        } else if (typeof this.#state.expectedTaskCount === 'number') {
            const completed = Object.values(this.#state.tasks).filter((t) => t.status === 'COMPLETED').length;
            if (completed < this.#state.expectedTaskCount)
                pending = [`${completed}/${this.#state.expectedTaskCount} completed`];
        }
        // T3: fingerprints-vs-disk — detect stale/missing files after complete_task
        let staleFiles = [];
        try {
            for (const [taskId, info] of Object.entries(this.#state.tasks || {})) {
                if (info.status !== 'COMPLETED' || !info.filePath || !info.fileHash) continue;
                const current = fastFingerprint(info.filePath);
                if (!current) staleFiles.push(`${taskId}:${info.filePath} (missing)`);
                else if (current !== info.fileHash) staleFiles.push(`${taskId}:${info.filePath} (stale fingerprint)`);
            }
            for (const [fp, stored] of Object.entries(this.#state.fileFingerprints || {})) {
                if (staleFiles.some((s) => s.includes(fp))) continue;
                const current = fastFingerprint(fp);
                if (!current) staleFiles.push(`${fp} (missing)`);
                else if (current !== stored) staleFiles.push(`${fp} (stale fingerprint)`);
            }
        } catch {}
        const ok = pending.length === 0 && staleFiles.length === 0;
        return {
            ok,
            pending,
            staleFiles,
            completed: Object.keys(this.#state.tasks).filter((k) => this.#state.tasks[k].status === 'COMPLETED').length,
            expected: this.#state.expectedTaskCount ?? this.#state.expectedTasks?.length ?? null,
            state: this.#state.state,
        };
    }

    async getAudit({ limit = 20, offset = 0 } = {}) {
        this.#load();
        const all = this.#state.audit || [];
        const slice = all.slice(Math.max(0, all.length - limit - offset), all.length - offset).reverse();
        return slice.map((e) => ({
            id: e.id,
            ts: e.ts,
            phase: e.phase,
            decision: e.decision,
            reasoning: e.reasoning ? String(e.reasoning).slice(0, 300) : undefined,
        }));
    }

    // --- B2: Handoff persistence for cross-session continuity ---
    async setHandoff({ summary, nextSteps, pendingTasks } = {}) {
        this.#load();
        if (!summary || typeof summary !== 'string') {
            return this.#makeError('summary is required and must be a string', 'set_handoff');
        }
        this.#state.lastHandoff = {
            ts: Date.now(),
            summary,
            nextSteps: Array.isArray(nextSteps) ? nextSteps : [],
            pendingTasks: Array.isArray(pendingTasks) ? pendingTasks : [],
        };
        await this.#audit('HANDOFF', 'set_handoff', summary.slice(0, 100));
        await this.#persist();
        return { ok: true, lastHandoff: this.#state.lastHandoff };
    }

    async getHandoff() {
        this.#load();
        if (this.#state.lastHandoff) return this.#state.lastHandoff;
        // C3: fallback to compaction file — same anchor as writer (dirname(statePath))
        if (!this.#statePath) return null;
        try {
            const fallbackPath = join(dirname(this.#statePath), '.ostacky-handoff-compaction.json');
            const raw = readFileSync(fallbackPath, 'utf8');
            const data = JSON.parse(raw);
            if (data && typeof data.summary === 'string') return data;
        } catch {}
        return null;
    }

    async clearHandoff() {
        this.#load();
        const prev = this.#state.lastHandoff;
        this.#state.lastHandoff = null;
        // C3: also delete fallback compaction file (same anchor)
        if (this.#statePath) {
            try {
                unlinkSync(join(dirname(this.#statePath), '.ostacky-handoff-compaction.json'));
            } catch {}
        }
        await this.#audit('HANDOFF', 'clear_handoff', prev?.summary?.slice(0, 100) || 'none');
        await this.#persist();
        return { ok: true, cleared: prev };
    }

    async getState() {
        this.#load();
        return structuredClone(this.#state);
    }

    async getTasks() {
        this.#load();
        return { ...this.#state.tasks };
    }

    async getAvailableTransitions() {
        this.#load();
        return {
            currentState: this.#state.state,
            transitions: TRANSITIONS[this.#state.state] || [],
        };
    }

    // --- O6: Validate edit with fast fingerprint ---
    async validateEdit({ oldString, newString, content, taskId } = {}) {
        this.#load();
        if (this.#state.state !== 'EXECUTING_INLINE' && this.#state.state !== 'EXECUTING_SUBAGENTS') {
            return { outcome: 'CONFLICT', reason: `Cannot validate edit from state ${this.#state.state}` };
        }
        if (typeof content !== 'string' || typeof oldString !== 'string' || typeof newString !== 'string') {
            return { outcome: 'CONFLICT', reason: 'Missing required fields: content, oldString, newString' };
        }
        if (oldString.length === 0) {
            return { outcome: 'CONFLICT', reason: 'oldString cannot be empty' };
        }
        // Trivial idempotency: identical strings → nothing to do
        if (oldString === newString) {
            return { outcome: 'ALREADY_APPLIED', taskId, reason: 'oldString and newString are identical' };
        }
        // Count occurrences of oldString in content
        let oldCount = 0;
        let idx = 0;
        while ((idx = content.indexOf(oldString, idx)) !== -1) {
            oldCount++;
            idx += oldString.length;
        }
        // If oldString not found, check if newString is already present (edit was already applied)
        if (oldCount === 0) {
            if (content.includes(newString)) {
                return {
                    outcome: 'ALREADY_APPLIED',
                    taskId,
                    reason: 'oldString not found but newString is present — edit was already applied',
                };
            }
            return { outcome: 'CONFLICT', reason: 'oldString not found in content — file was modified externally' };
        }
        if (oldCount > 1) {
            return {
                outcome: 'CONFLICT',
                reason: `oldString found ${oldCount} times — need more context to disambiguate`,
            };
        }
        // oldString found exactly once → safe to replace
        return { outcome: 'EDITABLE', taskId };
    }

    /**
     * Marks a task as completed and records a file fingerprint.
     * Only valid in EXECUTING_INLINE or EXECUTING_SUBAGENTS states.
     */
    async completeTask({ taskId, filePath, fileHash } = {}) {
        this.#load();
        if (this.#state.state !== 'EXECUTING_INLINE' && this.#state.state !== 'EXECUTING_SUBAGENTS') {
            return this.#makeError(`Cannot complete task from state ${this.#state.state}`, 'complete_task');
        }
        if (!taskId) return { error: 'taskId is required' };
        if (!this.#state.tasks) this.#state.tasks = {};

        // O6: Use fast fingerprint if no hash provided
        const effectiveHash = fileHash || (filePath ? fastFingerprint(filePath) : null);

        this.#state.tasks[taskId] = {
            status: 'COMPLETED',
            completedAt: new Date().toISOString(),
            filePath: filePath || null,
            fileHash: effectiveHash,
        };
        if (filePath && effectiveHash) {
            if (!this.#state.fileFingerprints) this.#state.fileFingerprints = {};
            this.#state.fileFingerprints[filePath] = effectiveHash;
        }
        this.#trimTasks();
        const totalCompleted = Object.keys(this.#state.tasks).filter(
            (k) => this.#state.tasks[k].status === 'COMPLETED'
        ).length;
        // C2: checkpoint count-based cada 3er complete_task — mismo persist, sin escritura extra
        if (totalCompleted % 3 === 0) {
            const pendingForHandoff = Array.isArray(this.#state.expectedTasks)
                ? this.#state.expectedTasks.filter(
                      (id) => !this.#state.tasks[id] || this.#state.tasks[id].status !== 'COMPLETED'
                  )
                : [];
            this.#state.lastHandoff = {
                ts: Date.now(),
                summary: `Checkpoint auto: ${totalCompleted} tasks completadas`,
                nextSteps: pendingForHandoff.length ? [`Continuar con ${pendingForHandoff.join(', ')}`] : [],
                pendingTasks: pendingForHandoff,
            };
        }
        await this.#persist();
        await this.#audit('EXECUTING', 'complete_task', `taskId=${taskId}`);
        return {
            taskId,
            status: 'COMPLETED',
            totalCompleted,
        };
    }

    /**
     * Public flush — SYNCHRONOUS on purpose: SIGINT/SIGTERM handlers cannot await
     * (Node does not wait for async shutdown work). Drains the audit buffer into
     * state and runs a best-effort sync persist with a single non-spinning lock
     * attempt; skips persisting if another process currently holds the lock.
     */
    flush() {
        if (this.#auditBuffer.length > 0 && this.#state) {
            if (!this.#state.audit) this.#state.audit = [];
            for (const e of this.#auditBuffer) {
                if (!e.id) e.id = `aud-${e.ts}-${this.#state.auditSeq++}`;
            }
            this.#state.audit.push(...this.#auditBuffer);
            if (this.#state.audit.length > 100) this.#state.audit = this.#state.audit.slice(-100);
            this.#auditBuffer = [];
        }
        // T1: final persist path kept synchronous for graceful shutdown
        if (!this.#statePath || !this.#state || !this.#loaded) return;
        try {
            try {
                writeFileSync(this.#lockPidPath, String(process.pid), { encoding: 'utf8', flag: 'wx' });
            } catch (e) {
                if (e && e.code === 'EEXIST') return; // another process holds the lock — skip best-effort persist
                throw e;
            }
            try {
                writeFileSync(this.#lockHeartbeatPath, String(Date.now()), 'utf8');
            } catch {}
            const serialized = safeJsonStringify(this.#state, true);
            const tmp = this.#statePath + '.tmp.' + process.pid;
            writeFileSync(tmp, serialized, 'utf8');
            renameSync(tmp, this.#statePath);
            this.#releaseLock();
        } catch {
            /* shutdown persist is best-effort */
        }
    }
}

const statePath = resolve(process.env.OSTACKY_STATE_PATH || join(process.cwd(), '.opencode', 'ostacky-state.json'));
const controller = new OstackyController({ statePath });

/**
 * Wraps an async tool handler to ALWAYS return a response (even on error).
 * Without this, an unhandled exception in any tool handler leaves the LLM
 * waiting forever — the root cause of agent freezes.
 */
function safeHandler(fn) {
    return async (params) => {
        try {
            const result = await fn(params);
            return { content: [{ type: 'text', text: safeJsonStringify(result) }] };
        } catch (error) {
            log('tool:error', {
                name: fn.name || 'anonymous',
                error: error.message,
                stack: error.stack,
            });
            return {
                content: [{ type: 'text', text: safeJsonStringify({ error: error.message }) }],
                isError: true,
            };
        }
    };
}

const server = new McpServer({
    name: 'ostacky-controller',
    version: '0.7.2',
});

server.registerTool(
    'start_request',
    {
        description:
            'Start or reset a new request. Can be called from ANY state — resets state machine. Call this first.',
        inputSchema: z.object({
            requestId: z.string().optional().describe('Unique request ID'),
            changeId: z.string().optional().describe('Optional change ID for OpenSpec tracking'),
        }),
    },
    safeHandler(async ({ requestId, changeId }) => {
        log('tool:start_request');
        return await controller.startRequest({ requestId, changeId });
    })
);

server.registerTool(
    'request_clarification',
    {
        description:
            'Pause execution to ask the user for clarification. Use when the request is too vague to classify. Transitions to CLARIFICATION_PENDING — you MUST stop and wait for user response.',
        inputSchema: z.object({
            question: z.string().optional().describe('The clarification question'),
        }),
    },
    safeHandler(async ({ question }) => {
        log('tool:request_clarification');
        return await controller.requestClarification({ question });
    })
);

server.registerTool(
    'record_clarification',
    {
        description: 'Record that clarification was answered. Transitions to DISCOVERY.',
        inputSchema: z.object({}),
    },
    safeHandler(async () => {
        log('tool:record_clarification');
        return await controller.recordClarification();
    })
);

server.registerTool(
    'record_discovery',
    {
        description:
            'Record discovery complete with level classification. From INTERPRETATION_PENDING goes to ROUTE_DECISION_PENDING. From DISCOVERY goes to LEVEL_RESOLVED.',
        inputSchema: z.object({
            level: z.enum(['0', '0+1', '1+']).describe('Impact level'),
            routeDecisionId: z.string().optional().describe('Unique route decision ID'),
            snapshot: z.any().optional().describe('Optional CodeGraph snapshot (auto-compressed)'),
        }),
    },
    safeHandler(async ({ level, routeDecisionId, snapshot }) => {
        log('tool:record_discovery', { level });
        return await controller.recordDiscovery({ level, routeDecisionId, snapshot });
    })
);

server.registerTool(
    'consume_route_decision',
    {
        description: 'Consume the route decision (SPEC or DIRECT). Valid only in ROUTE_DECISION_PENDING.',
        inputSchema: z.object({
            decisionId: z.string().describe('Route decision ID from record_discovery'),
            choice: z.enum(['SPEC', 'DIRECT']).describe('Route choice'),
        }),
    },
    safeHandler(async ({ decisionId, choice }) => {
        log('tool:consume_route_decision', { choice });
        return await controller.consumeRouteDecision({ decisionId, choice });
    })
);

server.registerTool(
    'spec_complete',
    {
        description: 'Mark specification phase as complete. Transitions to EXECUTION_ANALYSIS.',
        inputSchema: z.object({}),
    },
    safeHandler(async () => {
        log('tool:spec_complete');
        return await controller.specComplete();
    })
);

server.registerTool(
    'record_execution_analysis',
    {
        description: 'Record execution analysis with snapshot. Transitions to EXECUTION_DECISION_PENDING.',
        inputSchema: z.object({
            executionDecisionId: z.string().optional().describe('Unique execution decision ID'),
            snapshot: z.any().optional().describe('Execution analysis snapshot'),
        }),
    },
    safeHandler(async ({ executionDecisionId, snapshot }) => {
        log('tool:record_execution_analysis');
        return await controller.recordExecutionAnalysis({ executionDecisionId, snapshot });
    })
);

server.registerTool(
    'consume_execution_decision',
    {
        description: 'Consume the execution mode decision (INLINE or SUBAGENT_DRIVEN).',
        inputSchema: z.object({
            decisionId: z.string().describe('Execution decision ID from record_execution_analysis'),
            mode: z.enum(['INLINE', 'SUBAGENT_DRIVEN']).describe('Execution mode'),
        }),
    },
    safeHandler(async ({ decisionId, mode }) => {
        log('tool:consume_execution_decision', { mode });
        return await controller.consumeExecutionDecision({ decisionId, mode });
    })
);

server.registerTool(
    'implementation_complete',
    {
        description:
            'Mark implementation as complete. Transitions to SYNC. Returns error without transitioning if tasks pending unless {force:true}.',
        inputSchema: z.object({
            force: z
                .boolean()
                .optional()
                .describe('Force transition even with pending tasks (requires explicit user confirmation)'),
        }),
    },
    safeHandler(async ({ force }) => {
        log('tool:implementation_complete', { force: !!force });
        return await controller.implementationComplete({ force: !!force });
    })
);

server.registerTool(
    'sync_complete',
    {
        description: 'Mark sync as complete. Transitions to DONE.',
        inputSchema: z.object({}),
    },
    safeHandler(async () => {
        log('tool:sync_complete');
        return await controller.syncComplete();
    })
);

server.registerTool(
    'block',
    {
        description: 'Transition to BLOCKED state with an optional reason.',
        inputSchema: z.object({
            reason: z.string().optional().describe('Reason for blocking'),
        }),
    },
    safeHandler(async ({ reason }) => {
        log('tool:block');
        return await controller.block({ reason });
    })
);

server.registerTool(
    'replan',
    {
        description: 'Replan from BLOCKED state back to INTERPRETATION_PENDING.',
        inputSchema: z.object({
            reason: z.string().optional().describe('Reason for replanning'),
        }),
    },
    safeHandler(async ({ reason }) => {
        log('tool:replan');
        return await controller.replan({ reason });
    })
);

server.registerTool(
    'set_expected_tasks',
    {
        description:
            'Register expected task IDs for the integrity gate (controller as source of truth). Call after execution analysis.',
        inputSchema: z.object({
            taskIds: z.array(z.string()).optional().describe('Array of expected task IDs'),
            taskCount: z.number().optional().describe('Fallback count when IDs not available'),
        }),
    },
    safeHandler(async ({ taskIds, taskCount }) => {
        log('tool:set_expected_tasks', { count: taskIds?.length ?? taskCount });
        return await controller.setExpectedTasks({ taskIds, taskCount });
    })
);

server.registerTool(
    'verify_integrity',
    {
        description:
            'Verify execution integrity: compare expectedTasks vs completed tasks. Use before implementation_complete.',
        inputSchema: z.object({}),
    },
    safeHandler(async () => {
        log('tool:verify_integrity');
        return await controller.verifyIntegrity();
    })
);

server.registerTool(
    'get_audit',
    {
        description: 'Get recent audit entries paginated. Read-only, truncated to 300 chars with unique id per entry.',
        inputSchema: z.object({
            limit: z.number().optional().describe('Max entries (default 20)'),
            offset: z.number().optional().describe('Offset from end (default 0)'),
        }),
    },
    safeHandler(async ({ limit, offset }) => {
        log('tool:get_audit', { limit, offset });
        return await controller.getAudit({ limit, offset });
    })
);

server.registerTool(
    'proceed_to_route',
    {
        description:
            'Proceed from LEVEL_RESOLVED to ROUTE_DECISION_PENDING after discovery is confirmed. Only valid from LEVEL_RESOLVED — call this after asking the user about the route decision.',
        inputSchema: z.object({}),
    },
    safeHandler(async () => {
        log('tool:proceed_to_route');
        return await controller.proceedToRoute();
    })
);

server.registerTool(
    'abandon',
    {
        description: 'Abandon the current request. Transitions to BLOCKED from most states, or to DONE from BLOCKED.',
        inputSchema: z.object({
            reason: z.string().optional().describe('Reason for abandoning'),
        }),
    },
    safeHandler(async ({ reason }) => {
        log('tool:abandon');
        return await controller.abandon({ reason });
    })
);

server.registerTool(
    'ping',
    {
        description:
            'Health check — returns pong if controller is alive. Use this to verify controller availability before making other calls.',
        inputSchema: z.object({}),
    },
    safeHandler(async () => {
        return {
            pong: true,
            degraded: controller.degraded,
            state: await controller.getState().then((s) => ({
                state: s.state,
                revision: s.revision,
                requestId: s.requestId,
            })),
        };
    })
);

server.registerTool(
    'get_state',
    {
        description: 'Get the current controller state (reads persistent store).',
        inputSchema: z.object({}),
    },
    safeHandler(async () => {
        return await controller.getState();
    })
);

server.registerTool(
    'get_tasks',
    {
        description: 'Get current task states.',
        inputSchema: z.object({}),
    },
    safeHandler(async () => {
        return await controller.getTasks();
    })
);

server.registerTool(
    'get_available_transitions',
    {
        description: 'Get valid transitions from current state. Useful for debugging state machine issues.',
        inputSchema: z.object({}),
    },
    safeHandler(async () => {
        return await controller.getAvailableTransitions();
    })
);

server.registerTool(
    'set_handoff',
    {
        description:
            'Save handoff context for the next session. Call at session end if interrupted or before a context switch. Persists to controller state.',
        inputSchema: z.object({
            summary: z.string().describe('What we were working on (1-3 sentences)'),
            nextSteps: z.array(z.string()).optional().describe('Concrete next actions'),
            pendingTasks: z.array(z.string()).optional().describe('Task IDs or descriptions of pending work'),
        }),
    },
    safeHandler(async ({ summary, nextSteps, pendingTasks }) => {
        return await controller.setHandoff({ summary, nextSteps, pendingTasks });
    })
);

server.registerTool(
    'get_handoff',
    {
        description: 'Read pending handoff from previous session. Call at start of new request to recover context.',
        inputSchema: z.object({}),
    },
    safeHandler(async () => {
        return await controller.getHandoff();
    })
);

server.registerTool(
    'clear_handoff',
    {
        description: 'Mark handoff as consumed after the agent has loaded the context.',
        inputSchema: z.object({}),
    },
    safeHandler(async () => {
        return await controller.clearHandoff();
    })
);

server.registerTool(
    'check_pending_state',
    {
        description:
            'Check if agent is in a pending state waiting for user input. ' +
            'MUST be called before ANY tool call when controller is available. ' +
            'Returns ALLOW or BLOCKED with reason. ' +
            'EXCEPTION: controller tools (consume_route_decision, consume_execution_decision, ' +
            'record_clarification, abandon) are ALWAYS allowed — they unlock the state.',
        inputSchema: z.object({}),
    },
    safeHandler(async () => {
        const state = await controller.getState();
        const pendingStates = ['CLARIFICATION_PENDING', 'ROUTE_DECISION_PENDING', 'EXECUTION_DECISION_PENDING'];
        if (pendingStates.includes(state.state)) {
            return {
                status: 'BLOCKED',
                state: state.state,
                revision: state.revision,
                reason: `Cannot execute tools while in ${state.state}. Wait for user response first.`,
                degraded: controller.degraded,
            };
        }
        return { status: 'ALLOW', state: state.state, revision: state.revision, degraded: controller.degraded };
    })
);

server.registerTool(
    'validate_edit',
    {
        description:
            'Validate an edit against current file content. Returns EDITABLE, ALREADY_APPLIED, or CONFLICT. ' +
            'Call BEFORE executing an edit tool. Only valid in EXECUTING_INLINE or EXECUTING_SUBAGENTS states. ' +
            'IMPORTANT: content parameter is REQUIRED. Read the file first, then pass the full content.',
        inputSchema: z.object({
            oldString: z.string().describe('The exact string to find in content (must be unique).'),
            newString: z.string().describe('The replacement string.'),
            content: z
                .string()
                .describe(
                    'REQUIRED — The full file content. ' +
                        'You MUST read the file first with the Read tool, then pass the complete content here. ' +
                        'Example: call Read on the file, store the output, then call validate_edit with that content. ' +
                        'Without this parameter, validate_edit will fail.'
                ),
            taskId: z.string().optional().describe('Optional task ID for tracking.'),
        }),
    },
    safeHandler(async ({ oldString, newString, content, taskId }) => {
        log('tool:validate_edit', {
            taskId,
            oldLen: oldString?.length,
            newLen: newString?.length,
            hasContent: !!content,
        });
        if (typeof content !== 'string' || typeof oldString !== 'string' || typeof newString !== 'string') {
            return {
                outcome: 'CONFLICT',
                reason: 'Missing required fields: content, oldString, and newString are all required. Read the file first, then pass content to validate_edit.',
            };
        }
        return await controller.validateEdit({ oldString, newString, content, taskId });
    })
);

server.registerTool(
    'complete_task',
    {
        description:
            'Mark a task as completed and optionally record a file fingerprint. ' +
            'Only valid in EXECUTING_INLINE or EXECUTING_SUBAGENTS states.',
        inputSchema: z.object({
            taskId: z.string().describe('The task ID to mark as completed.'),
            filePath: z.string().optional().describe('Optional file path that was modified.'),
            fileHash: z
                .string()
                .optional()
                .describe('Optional SHA-256 or fast fingerprint of the file after modification.'),
        }),
    },
    safeHandler(async ({ taskId, filePath, fileHash }) => {
        log('tool:complete_task', { taskId, filePath });
        return await controller.completeTask({ taskId, filePath, fileHash });
    })
);

/**
 * Graceful shutdown: clean up tmp/lock files and flush state.
 */
function setupGracefulShutdown(ctrl) {
    const shutdown = (signal) => {
        log('shutdown', { signal });
        // Final persist attempt (flush via public method, sync inside)
        try {
            if (ctrl) ctrl.flush();
        } catch {
            /* best-effort */
        }
        // Clean up own tmp and lock files
        try {
            cleanupTmpFiles(statePath);
        } catch {
            /* best-effort */
        }
        process.exit(signal === 'SIGINT' ? 130 : 0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGHUP', () => shutdown('SIGHUP'));
    process.on('SIGPIPE', () => shutdown('SIGPIPE'));
    // Prevent unhandled rejections from silently killing the server
    process.on('unhandledRejection', (reason) => {
        log('unhandled_rejection', { reason: String(reason) });
    });
}

async function main() {
    log('Starting ostacky-controller MCP v0.7.2...');
    log('State path:', { path: statePath });
    // Clean up stale tmp/lock files from previous runs
    cleanupTmpFiles(statePath);
    setupGracefulShutdown(controller);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log('ostacky-controller connected and ready');
}

const isDirectRun =
    process.argv[1] && (process.argv[1].endsWith('/index.js') || process.argv[1].endsWith('\\index.js'));

if (isDirectRun) {
    main().catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

export { OstackyController, STATES, DEFAULT_STATE };
