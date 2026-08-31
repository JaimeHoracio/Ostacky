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
import { dirname, basename, join, resolve, relative } from 'node:path';
import { writeFile as writeFileAsync, rename as renameAsync, mkdir as mkdirAsync } from 'node:fs/promises';
import { SENSITIVE_DEFAULT, BASH_SENSITIVE_RE, isSensitive, extractPathsFromBash } from './security.js';

// T1: non-blocking wait — replaces busy-wait spins that froze the event loop
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Constants (Fase 5.5 — headroom generoso) ---
const MAX_TASKS = 100;
const MAX_TASKS_DEFAULT = 100;
const MAX_TASKS_CAP = 500;
const MAX_SNAPSHOT_JSON_LENGTH = 50 * 1024;
const MAX_STATE_FILE_SIZE = 2 * 1024 * 1024;
const DEGRADED_THRESHOLD = 3; // consecutive failures before auto-degraded mode

function getMaxTasks() {
    const raw = process.env.OSTACKY_MAX_TASKS;
    if (raw == null || raw === '') return MAX_TASKS_DEFAULT;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || n <= 0) return MAX_TASKS_DEFAULT;
    if (n > MAX_TASKS_CAP) {
        log('warn:max_tasks_capped', { requested: n, capped: MAX_TASKS_CAP });
        return MAX_TASKS_CAP;
    }
    return n;
}

function getProjectRoot(statePath) {
    if (!statePath) return resolve(process.cwd());
    return dirname(dirname(resolve(statePath)));
}

function isPathInsideProject(filePath, statePath) {
    if (!filePath) return true;
    try {
        const projectRoot = getProjectRoot(statePath);
        const resolved = resolve(projectRoot, filePath);
        const rel = relative(projectRoot, resolved);
        // reject if rel starts with .. or is absolute outside
        if (rel.startsWith('..' + join('', '')) || rel === '..' || rel.startsWith('..')) return false;
        // also reject absolute paths outside project
        if (resolve(filePath) !== resolved && filePath.startsWith('/')) {
            const absRel = relative(projectRoot, resolve(filePath));
            if (absRel.startsWith('..')) return false;
        }
        return true;
    } catch {
        return false;
    }
}

function isValidTaskId(taskId) {
    return typeof taskId === 'string' && /^[a-zA-Z0-9-_.\/:]+$/.test(taskId);
}

function getAuditRetention() {
    const raw = process.env.OSTACKY_AUDIT_RETENTION;
    if (raw == null || raw === '') return 500;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || n <= 0) return 500;
    if (n > 2000) return 2000;
    return n;
}

function getAuditRetentionSafe() {
    return getAuditRetention();
}

function redactSecrets(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const str = safeJsonStringify(obj);
    // redact after stringify for persistence — handled in persist
    return obj;
}

const SENSITIVE_REDACT_RE = /(apiKey|secret|token|password|api_key)/i;

// D1: source-of-truth — src/security.ts (via ./security.js) — isSensitive, SENSITIVE_DEFAULT, BASH_SENSITIVE_RE, extractPathsFromBash imported above

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

function redactForLog(data) {
    if (!data || typeof data !== 'object') return data;
    try {
        const str = safeJsonStringify(data);
        // redact sensitive keys
        if (SENSITIVE_REDACT_RE.test(str)) {
            const copy = JSON.parse(str);
            const redactRecursively = (obj) => {
                if (!obj || typeof obj !== 'object') return;
                for (const k of Object.keys(obj)) {
                    if (SENSITIVE_REDACT_RE.test(k)) obj[k] = '[REDACTED]';
                    else if (typeof obj[k] === 'object') redactRecursively(obj[k]);
                }
            };
            redactRecursively(copy);
            return copy;
        }
        return data;
    } catch {
        return data;
    }
}

function log(eventOrLevel, maybeEventOrData, maybeData) {
    let level = 'info';
    let event = eventOrLevel;
    let data = maybeEventOrData;
    if (maybeData !== undefined) {
        level = eventOrLevel;
        event = maybeEventOrData;
        data = maybeData;
    } else {
        // infer level from prefix
        if (event.startsWith('warn:')) {
            level = 'warn';
        } else if (event.startsWith('error:')) {
            level = 'error';
        } else if (event.startsWith('info:')) {
            level = 'info';
        } else if (event.startsWith('degraded_')) {
            level = 'warn';
        }
    }
    const ts = new Date().toISOString();
    const safeData = redactForLog(data);
    const payload = safeData ? ` ${safeJsonStringify(safeData)}` : '';
    console.error(`[${ts}] ${level}:${event}${payload}`);
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

// States where start_request should reset (not resume) when force=false
const TERMINAL_STATES = Object.freeze([
    STATES.INTERPRETATION_PENDING,
    STATES.CLARIFICATION_PENDING,
    STATES.BLOCKED,
    STATES.DONE,
]);

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
    degraded: false, // D2: persisted degraded flag for restart observability
    schemaVersion: 1, // D3: schema version for migrations
    stateOversizedCount: 0, // 2.3
    codegraphBypassCount: 0, // 6.3 / 3.1
    degradedEditsCount: 0, // 8.5
    cacheHitCount: 0, // 5.4 hardening-v2
    cacheMissCount: 0,
    tokenSavingEstimate: 0,
    lastProposal: null, // 8.1
    allowedFiles: {}, // 9.2
    deniedFiles: {}, // 9.2
    sensitivePatterns: [
        '**/.env*',
        '**/.secrets/**',
        '**/*.pem',
        '**/*.key',
        '**/.aws/**',
        '**/.ssh/**',
        '**/credentials.json',
        '**/.npmrc',
    ], // 9.1
    sensitiveAccess: { allowed: 0, denied: 0, blockedAttempts: 0 }, // 9.3
    staleContentAttempts: 0, // 10.4
    completeWithoutValidateCount: 0, // 10.5
    toolTimeoutCount: 0, // 11.1
    lastToolDurationMs: 0, // 11.4
    stateDurationMs: 0, // 11.4
    subagentFailedCount: 0, // 10.6
    lastValidated: null, // 10.5 {filePath, hash, ts}
    pendingFileAccess: {}, // 9.2
    // Heartbeat monitoring for external watchdog (30s stale threshold)
    lastHeartbeat: 0, // epoch ms, updated on each successful tool completion
    watchdogEnabled: true, // when false, external watchdog should not restart based on heartbeat
    ts: Date.now(), // for uptime
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
    #lockOwner = false;

    constructor(opts = {}) {
        this.#statePath = opts.statePath;
        this.#lockPath = opts.statePath ? opts.statePath + '.lock' : null;
        this.#lockPidPath = opts.statePath ? opts.statePath + '.lock.pid' : null;
        this.#lockHeartbeatPath = opts.statePath ? opts.statePath + '.lock.timestamp' : null;
        if (typeof opts.lockMaxAttempts === 'number' && opts.lockMaxAttempts > 0) {
            this.#lockMaxAttempts = opts.lockMaxAttempts;
        }
        if (opts.initialState) {
            this.#state = { ...structuredClone(DEFAULT_STATE), ...opts.initialState };
            this.#degraded = !!this.#state.degraded;
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
     * Updates the lastHeartbeat timestamp to now.
     * Called after successful tool completion for external watchdog monitoring.
     * External watchdog contract: if Date.now() - lastHeartbeat > 30000 and watchdogEnabled === true,
     * the watchdog should restart the MCP server process.
     */
    updateHeartbeat() {
        if (this.#state) {
            this.#state.lastHeartbeat = Date.now();
        }
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
                this.#heartbeatLock();
                this.#lockOwner = true;
                return true;
            } catch {
                const base = Math.min(lockTimeout, 100 * Math.pow(2, attempt));
                const jitter = Math.floor(Math.random() * 200) - 100;
                const waitMs = Math.max(0, base + jitter);
                if (waitMs > 0) await sleep(waitMs);
            }
        }
        log('warn:lock_acquire_failed', { attempts: maxAttempts });
        this.#lockOwner = false;
        return false;
    }

    #releaseLock() {
        if (!this.#lockPath) return;
        // D2: verify ownership before deleting — never delete another process's lock
        try {
            const ownerPid = readFileSync(this.#lockPidPath, 'utf8').trim();
            if (ownerPid !== String(process.pid)) {
                this.#lockOwner = false;
                return;
            }
        } catch {
            if (!this.#lockOwner) return;
        }
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
        this.#lockOwner = false;
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
            this.#state = structuredClone(DEFAULT_STATE);
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
            this.#state = { ...structuredClone(DEFAULT_STATE), ...parsed };
            let migrated = false;
            if ((parsed.schemaVersion ?? 0) < 1) {
                if (typeof this.#state.snapshots?.codegraph === 'string') {
                    try {
                        this.#state.snapshots.codegraph = JSON.parse(this.#state.snapshots.codegraph);
                        migrated = true;
                    } catch {}
                }
                if (typeof this.#state.snapshots?.execution === 'string') {
                    try {
                        this.#state.snapshots.execution = JSON.parse(this.#state.snapshots.execution);
                        migrated = true;
                    } catch {}
                }
                if (typeof this.#state.expectedTasks === 'string') {
                    try {
                        const v = JSON.parse(this.#state.expectedTasks);
                        this.#state.expectedTasks = Array.isArray(v) ? v : v ? [String(v)] : null;
                        migrated = true;
                    } catch {}
                }
                if (Array.isArray(this.#state.audit)) {
                    for (const e of this.#state.audit) {
                        if (!e.id) {
                            e.id = `aud-${e.ts || Date.now()}-${this.#state.auditSeq++}`;
                            migrated = true;
                        }
                    }
                }
                this.#state.schemaVersion = 1;
                if (migrated) log('info:schema_migrated', { from: parsed.schemaVersion ?? 0, to: 1 });
            }
            // Migration for heartbeat fields (added in controller-resilience-improvements)
            if (this.#state.lastHeartbeat === undefined) {
                this.#state.lastHeartbeat = 0;
                migrated = true;
            }
            if (this.#state.watchdogEnabled === undefined) {
                this.#state.watchdogEnabled = true;
                migrated = true;
            }
            if (migrated)
                log('info:heartbeat_fields_migrated', {
                    lastHeartbeat: this.#state.lastHeartbeat,
                    watchdogEnabled: this.#state.watchdogEnabled,
                });
            this.#degraded = !!this.#state.degraded;
            this.#loaded = true;
            return;
        } catch (err) {
            log('warn:load_primary_failed', { error: err.message });
        }
        // Fallback: try .backup, .backup.1, .backup.2 (2.1 rotativo)
        for (const suffix of ['.backup', '.backup.1', '.backup.2']) {
            const backupPath = this.#statePath + suffix;
            try {
                const raw = readFileSync(backupPath, 'utf8');
                if (raw.length > MAX_STATE_FILE_SIZE) throw new Error(`Backup too large: ${raw.length} bytes`);
                const parsed = JSON.parse(raw);
                const validationError = this.#validateState(parsed);
                if (validationError) throw new Error(`Backup validation failed: ${validationError}`);
                this.#state = {
                    ...structuredClone(DEFAULT_STATE),
                    ...parsed,
                    error: suffix === '.backup' ? 'State restored from backup' : `State restored from ${suffix}`,
                };
                let backupMigrated = false;
                if ((parsed.schemaVersion ?? 0) < 1) {
                    if (typeof this.#state.snapshots?.codegraph === 'string') {
                        try {
                            this.#state.snapshots.codegraph = JSON.parse(this.#state.snapshots.codegraph);
                            backupMigrated = true;
                        } catch {}
                    }
                    if (typeof this.#state.snapshots?.execution === 'string') {
                        try {
                            this.#state.snapshots.execution = JSON.parse(this.#state.snapshots.execution);
                            backupMigrated = true;
                        } catch {}
                    }
                    if (Array.isArray(this.#state.audit)) {
                        for (const e of this.#state.audit) {
                            if (!e.id) {
                                e.id = `aud-${e.ts || Date.now()}-${this.#state.auditSeq++}`;
                                backupMigrated = true;
                            }
                        }
                    }
                    this.#state.schemaVersion = 1;
                }
                // Migration for heartbeat fields in backups
                if (this.#state.lastHeartbeat === undefined) {
                    this.#state.lastHeartbeat = 0;
                    backupMigrated = true;
                }
                if (this.#state.watchdogEnabled === undefined) {
                    this.#state.watchdogEnabled = true;
                    backupMigrated = true;
                }
                if (backupMigrated)
                    log('info:backup_heartbeat_fields_migrated', {
                        lastHeartbeat: this.#state.lastHeartbeat,
                        watchdogEnabled: this.#state.watchdogEnabled,
                    });
                this.#degraded = !!this.#state.degraded;
                log('warn:state_restored_from_backup', { suffix });
                this.#loaded = true;
                return;
            } catch {}
        }
        try {
            throw new Error('All backups failed');
        } catch (backupErr) {
            // No backup either — set error state instead of silent reset
            this.#state = {
                ...structuredClone(DEFAULT_STATE),
                error: `State file corrupt: ${backupErr.message}. No backup available. State reset to default.`,
            };
            this.#degraded = !!this.#state.degraded;
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

        let didAcquire = false;
        try {
            // 3.4: Acquire lock before writing
            const lockAcquired = await this.#acquireLock();
            if (!lockAcquired) {
                log('warn:persist_skipped_lock', { state: this.#state.state });
                throw new Error('Could not acquire state file lock');
            }
            didAcquire = lockAcquired;

            // 4.2: redact sensitive before serialize (do not mutate original long-term, but ensure file is redacted)
            const stateForSerialize = (() => {
                try {
                    const copy = JSON.parse(safeJsonStringify(this.#state));
                    const redactRecursively = (obj) => {
                        if (!obj || typeof obj !== 'object') return;
                        for (const k of Object.keys(obj)) {
                            if (SENSITIVE_REDACT_RE.test(k)) {
                                obj[k] = '[REDACTED]';
                            } else if (typeof obj[k] === 'string' && SENSITIVE_REDACT_RE.test(obj[k])) {
                                obj[k] = obj[k]
                                    .replace(/(apiKey|secret|token|password|api_key)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
                                    .replace(/sk-[a-zA-Z0-9_-]+/g, '[REDACTED]');
                                if (SENSITIVE_REDACT_RE.test(obj[k])) obj[k] = '[REDACTED]';
                            } else if (typeof obj[k] === 'object') {
                                redactRecursively(obj[k]);
                            }
                        }
                    };
                    redactRecursively(copy);
                    if (copy.snapshots) redactRecursively(copy.snapshots);
                    if (copy.audit) copy.audit.forEach(redactRecursively);
                    return copy;
                } catch {
                    return this.#state;
                }
            })();
            let serialized = safeJsonStringify(stateForSerialize, true);
            if (serialized.length > MAX_STATE_FILE_SIZE) {
                log('warn:state_oversized', { size: serialized.length });
                this.#state.stateOversizedCount = (this.#state.stateOversizedCount || 0) + 1;
                const trimmed = { ...stateForSerialize, snapshots: { codegraph: null, execution: null } };
                serialized = safeJsonStringify(trimmed, true);
                if (serialized.length > MAX_STATE_FILE_SIZE) {
                    log('error:state_too_large_even_after_trim');
                    return;
                }
                this.#state.snapshots = { codegraph: null, execution: null };
                // also reflect in file copy
                stateForSerialize.snapshots = { codegraph: null, execution: null };
                serialized = safeJsonStringify(stateForSerialize, true);
            }
            const tmp = this.#statePath + '.tmp.' + process.pid;
            await writeFileAsync(tmp, serialized, 'utf8');
            await renameAsync(tmp, this.#statePath);
            // 2.1: backup rotativo 3 niveles best-effort
            try {
                try {
                    renameSync(this.#statePath + '.backup.1', this.#statePath + '.backup.2');
                } catch {}
                try {
                    renameSync(this.#statePath + '.backup', this.#statePath + '.backup.1');
                } catch {}
            } catch {}
            try {
                const backupTmp = this.#statePath + '.backup.tmp.' + process.pid;
                await writeFileAsync(backupTmp, serialized, 'utf8');
                await renameAsync(backupTmp, this.#statePath + '.backup');
            } catch {
                /* backup is best-effort */
            }
            // B1: persist success → reset failure counter + auto-exit degraded
            if (this.#consecutiveFailures > 0) {
                log('info:persist_recovered', { after: this.#consecutiveFailures });
            }
            this.#consecutiveFailures = 0;
            if (this.#degraded) this.#exitDegradedMode();
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
            if (didAcquire) this.#releaseLock();
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
        const limit = getMaxTasks();
        const entries = Object.entries(this.#state.tasks);
        if (entries.length <= limit) return;
        const expectedSet = new Set(Array.isArray(this.#state.expectedTasks) ? this.#state.expectedTasks : []);
        const expectedEntries = entries.filter(([id]) => expectedSet.has(id));
        const nonExpectedEntries = entries.filter(([id]) => !expectedSet.has(id));
        const excess = entries.length - limit;
        if (nonExpectedEntries.length >= excess) {
            nonExpectedEntries.sort((a, b) => {
                const da = a[1].completedAt || '';
                const db = b[1].completedAt || '';
                return db.localeCompare(da);
            });
            const keepNonExpected = nonExpectedEntries.slice(0, nonExpectedEntries.length - excess);
            const kept = [...expectedEntries, ...keepNonExpected];
            kept.sort((a, b) => {
                const da = a[1].completedAt || '';
                const db = b[1].completedAt || '';
                return db.localeCompare(da);
            });
            this.#state.tasks = Object.fromEntries(kept.slice(0, limit));
            log('warn:tasks_trimmed', {
                before: entries.length,
                after: limit,
                preservedExpected: expectedEntries.length,
            });
            return;
        }
        const sortedExpected = [...expectedEntries].sort((a, b) => {
            const da = a[1].completedAt || '';
            const db = b[1].completedAt || '';
            return da.localeCompare(db);
        });
        const needToArchive = excess - nonExpectedEntries.length;
        if (needToArchive > 0) {
            for (let i = 0; i < Math.min(needToArchive, sortedExpected.length); i++) {
                const [taskId] = sortedExpected[i];
                log('info:task_archived_to_engram', {
                    taskId,
                    topic: `harness/archive/${this.#state.requestId || 'unknown'}-${taskId}`,
                });
            }
            sortedExpected.sort((a, b) => {
                const da = a[1].completedAt || '';
                const db = b[1].completedAt || '';
                return db.localeCompare(da);
            });
            const keepExpectedCount = expectedEntries.length - needToArchive;
            const keepExpected = sortedExpected.slice(0, keepExpectedCount);
            const kept = [...keepExpected, ...nonExpectedEntries];
            kept.sort((a, b) => {
                const da = a[1].completedAt || '';
                const db = b[1].completedAt || '';
                return db.localeCompare(da);
            });
            this.#state.tasks = Object.fromEntries(kept.slice(0, limit));
            log('warn:tasks_trimmed_with_archive', { before: entries.length, after: limit, archived: needToArchive });
            return;
        }
        log('warn:tasks_over_limit_no_trim', { before: entries.length, limit, expected: expectedEntries.length });
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
        let redactedReasoning = reasoning ? String(reasoning).slice(0, 300) : undefined;
        if (redactedReasoning && SENSITIVE_REDACT_RE.test(redactedReasoning)) {
            redactedReasoning = redactedReasoning.replace(SENSITIVE_REDACT_RE, '[REDACTED]');
            // also redact values after = if present
            redactedReasoning = redactedReasoning.replace(
                /(apiKey|secret|token|password|api_key)\s*[:=]\s*\S+/gi,
                '$1=[REDACTED]'
            );
        }
        const id = `aud-${Date.now()}-${this.#state.auditSeq++}`;
        this.#auditBuffer.push({
            id,
            ts: Date.now(),
            phase,
            decision,
            reasoning: redactedReasoning,
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
            // 4.2: redact sensitive in audit
            if (e.reasoning && SENSITIVE_REDACT_RE.test(e.reasoning)) {
                e.reasoning = e.reasoning.replace(SENSITIVE_REDACT_RE, '[REDACTED]');
            }
            // redact any lingering snapshot data in reasoning
            if (e.reasoning && /(apiKey|secret|token|password)/i.test(e.reasoning)) {
                e.reasoning = e.reasoning.replace(/(apiKey|secret|token|password)\s*[:=]\s*\S+/gi, '$1=[REDACTED]');
            }
        }
        this.#state.audit.push(...this.#auditBuffer);
        const retention = getAuditRetentionSafe();
        if (this.#state.audit.length > retention) {
            this.#state.audit = this.#state.audit.slice(-retention);
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
        if (this.#state) this.#state.degraded = true;
        log('degraded_mode_activated', { reason, state: this.#state?.state });
        if (this.#state && this.#statePath) {
            try {
                this.#persist().catch(() => {});
            } catch {}
        }
    }

    #exitDegradedMode() {
        if (!this.#degraded) return;
        this.#degraded = false;
        this.#consecutiveFailures = 0;
        if (this.#state) this.#state.degraded = false;
        log('degraded_mode_exited', { state: this.#state?.state });
        if (this.#state && this.#statePath) {
            try {
                this.#persist().catch(() => {});
            } catch {}
        }
    }

    // --- Core transitions ---

    async startRequest({ requestId, changeId, force = false } = {}) {
        this.#load();

        // If not forcing and current state is active (not terminal), resume instead of reset
        if (!force && !TERMINAL_STATES.includes(this.#state.state) && this.#state.requestId) {
            await this.#audit(
                this.#state.state,
                'start_request',
                `resumed from ${this.#state.state}, requestId=${this.#state.requestId}`
            );
            return {
                state: this.#state.state,
                revision: this.#state.revision,
                requestId: this.#state.requestId,
                continued: true,
            };
        }

        // Force reset or terminal state: create new session
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
        await this.#audit(
            'INTERPRETATION_PENDING',
            'start_request',
            `requestId=${this.#state.requestId}${force ? ' (forced)' : ''}`
        );
        return {
            state: this.#state.state,
            revision: this.#state.revision,
            requestId: this.#state.requestId,
            continued: false,
        };
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
        // 4.4: validación de enums
        if (level && !['0', '0+1', '1+'].includes(level)) {
            return { error: `invalid level: ${level}`, available: ['0', '0+1', '1+'] };
        }
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
        // 8.1/8.2: lastProposal handling — reasoning con plan exigido
        let shownToUser = false;
        let proposalFiles = [];
        let estLines = 0;
        if (snapshot?.reasoning && typeof snapshot.reasoning === 'object') {
            if (Array.isArray(snapshot.reasoning.files) && typeof snapshot.reasoning.estLines === 'number') {
                shownToUser = true;
                proposalFiles = snapshot.reasoning.files;
                estLines = snapshot.reasoning.estLines;
            }
        } else if (snapshot?.files && snapshot?.estLines) {
            shownToUser = true;
            proposalFiles = snapshot.files;
            estLines = snapshot.estLines;
        }
        const lastProposal = {
            ts: Date.now(),
            requestId: this.#state.requestId,
            summary: `recordDiscovery level=${level} files=${proposalFiles.join(',')} estLines=${estLines}`,
            files: proposalFiles,
            estLines,
            level,
            routeChoice: defaultChoice,
            shownToUser,
        };
        await this.#transition(to, {
            routeDecisionId: routeDecisionId || 'route-' + Date.now(),
            routeChoice: defaultChoice, // O2: persist default suggested choice
            level, // O1: persist level for conditional persistence
            snapshots: { ...this.#state.snapshots, codegraph: compressedSnapshot },
            lastProposal,
        });
        await this.#audit('LEVEL_RESOLVED', 'record_discovery', `level=${level}, default=${defaultChoice}`);
        // 8.2: reasoning sin plan → WARN
        if (!shownToUser && !isTrivial) {
            const auditId = `aud-${Date.now()}-${this.#state.auditSeq}`;
            log('warn:proposal_without_transparent_plan', { level, auditId });
            await this.#audit(
                'WARN',
                'proposal_without_transparent_plan',
                `level=${level} reasoning missing files/estLines`
            );
            this.#state.lastProposal.shownToUser = false;
            await this.#persist();
            const lastAudit = this.#state.audit?.[this.#state.audit.length - 1];
            return {
                state: this.#state.state,
                revision: this.#state.revision,
                level,
                routeDecisionId: this.#state.routeDecisionId,
                defaultChoice,
                warning: 'proposal without transparent plan',
                auditId: lastAudit?.id || auditId,
            };
        }
        // C2: warning if no evidence and not degraded and not trivial — also count bypass
        if (!hasEvidence && !this.#degraded && !isTrivial) {
            this.#state.codegraphBypassCount = (this.#state.codegraphBypassCount || 0) + 1;
            const auditId = `aud-${Date.now()}-${this.#state.auditSeq}`;
            log('warn:discovery_without_codegraph', { level, auditId });
            await this.#audit('WARN', 'discovery_without_codegraph', `level=${level} symbols missing`);
            await this.#persist();
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
        // 8.6: Bypass solo para CI
        if (process.env.OSTACKY_REQUIRE_CONFIRMATION === 'false' && this.#state.state === 'ROUTE_DECISION_PENDING') {
            await this.#audit('AUTO', 'auto-confirm (CI)', `auto-consume ${defaultChoice} for CI`);
            const autoTo = this.#isAllowedTransition(this.#state.state, 'consume_route_decision', defaultChoice);
            if (autoTo) {
                await this.#transition(autoTo, { routeChoice: defaultChoice });
                await this.#audit(autoTo, 'consume_route_decision', `choice=${defaultChoice} auto-confirm (CI)`);
                return {
                    state: this.#state.state,
                    revision: this.#state.revision,
                    level,
                    routeDecisionId: this.#state.routeDecisionId,
                    defaultChoice,
                    autoConfirmed: true,
                };
            }
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
        if (choice && !['SPEC', 'DIRECT'].includes(choice)) {
            return { error: `invalid choice: ${choice}`, available: ['SPEC', 'DIRECT'] };
        }
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
        // 1.7: exigir expectedTaskIds/taskIds/taskCount cuando taskCount>0
        if (snapshot && typeof snapshot.taskCount === 'number' && snapshot.taskCount > 0) {
            const hasExpectedIds = Array.isArray(snapshot.expectedTaskIds) && snapshot.expectedTaskIds.length > 0;
            const hasTaskIds = Array.isArray(snapshot.taskIds) && snapshot.taskIds.length > 0;
            const hasCount = typeof snapshot.taskCount === 'number' && snapshot.taskCount > 0;
            if (!hasExpectedIds && !hasTaskIds && !hasCount) {
                return this.#makeError(
                    'Snapshot missing expectedTaskIds/taskIds/taskCount when taskCount>0',
                    'record_execution_analysis'
                );
            }
            if (!hasExpectedIds && !hasTaskIds) {
                return this.#makeError(
                    'Snapshot missing expectedTaskIds or taskIds when taskCount>0',
                    'record_execution_analysis'
                );
            }
        }
        // C2: capture expected tasks for gate
        const expectedTasks = snapshot?.expectedTaskIds || snapshot?.taskIds || null;
        const expectedTaskCount = snapshot?.taskCount ?? (Array.isArray(expectedTasks) ? expectedTasks.length : null);
        const isEarlyExitExec = snapshot?.globalRuleTriggered === 'early-exit' && (snapshot?.taskCount ?? 0) <= 2;
        // 8.1/8.2: lastProposal for execution — reasoning con plan
        let execShown = false;
        let execFiles = [];
        let execEst = 0;
        if (
            snapshot?.reasoning &&
            typeof snapshot.reasoning === 'object' &&
            Array.isArray(snapshot.reasoning.files) &&
            typeof snapshot.reasoning.estLines === 'number'
        ) {
            execShown = true;
            execFiles = snapshot.reasoning.files;
            execEst = snapshot.reasoning.estLines;
        } else if (snapshot?.files && snapshot?.estLines) {
            execShown = true;
            execFiles = snapshot.files;
            execEst = snapshot.estLines;
        } else if (snapshot?.sharedFiles && snapshot?.clusters) {
            // execution-mode-evaluation style: sharedFiles + clusters
            execShown = true;
            execFiles = snapshot.sharedFiles;
            execEst = snapshot.taskCount || 0;
        }
        const execLastProposal = {
            ts: Date.now(),
            requestId: this.#state.requestId,
            summary: `recordExecutionAnalysis files=${execFiles.join(',')} estLines=${execEst}`,
            files: execFiles,
            estLines: execEst,
            level: this.#state.level,
            routeChoice: this.#state.routeChoice,
            shownToUser: execShown,
        };
        await this.#transition(to, {
            executionDecisionId: executionDecisionId || 'exec-' + Date.now(),
            executionMode: null,
            snapshots: { ...this.#state.snapshots, execution: snapshot ? structuredClone(snapshot) : null },
            expectedTasks: Array.isArray(expectedTasks) ? [...expectedTasks] : null,
            expectedTaskCount: typeof expectedTaskCount === 'number' ? expectedTaskCount : null,
            lastProposal: execLastProposal,
        });
        await this.#audit('EXECUTION_DECISION_PENDING', 'record_execution_analysis');
        // 8.2: reasoning sin plan → WARN (but allow early-exit style)
        if (!execShown && snapshot && !isEarlyExitExec) {
            // Only warn if snapshot was expected to have reasoning (taskCount>2 or not early-exit)
            const auditId2 = `aud-${Date.now()}-${this.#state.auditSeq}`;
            log('warn:proposal_without_transparent_plan', { auditId: auditId2 });
            await this.#audit(
                'WARN',
                'proposal_without_transparent_plan',
                'execution reasoning missing files/estLines'
            );
            this.#state.lastProposal.shownToUser = false;
            await this.#persist();
        }
        // C2: warning if missing codegraphUsed+recommendation and not degraded — snapshot missing also counts
        // 1.7: early-exit with taskCount<=2 is valid without codegraphUsed, do not warn
        const hasEvidence =
            snapshot &&
            Array.isArray(snapshot.codegraphUsed) &&
            snapshot.codegraphUsed.length > 0 &&
            snapshot.recommendation != null;
        if (!hasEvidence && !this.#degraded && !isEarlyExitExec) {
            this.#state.codegraphBypassCount = (this.#state.codegraphBypassCount || 0) + 1;
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
        // 8.6: Bypass solo para CI
        if (
            process.env.OSTACKY_REQUIRE_CONFIRMATION === 'false' &&
            this.#state.state === 'EXECUTION_DECISION_PENDING'
        ) {
            await this.#audit('AUTO', 'auto-confirm (CI)', `auto-consume for CI`);
            const defaultMode =
                snapshot?.recommendation && ['INLINE', 'SUBAGENT_DRIVEN'].includes(snapshot.recommendation)
                    ? snapshot.recommendation
                    : 'INLINE';
            const autoTo = this.#isAllowedTransition(this.#state.state, 'consume_execution_decision', defaultMode);
            if (autoTo) {
                await this.#transition(autoTo, { executionMode: defaultMode });
                await this.#audit(autoTo, 'consume_execution_decision', `mode=${defaultMode} auto-confirm (CI)`);
                return {
                    state: this.#state.state,
                    revision: this.#state.revision,
                    executionDecisionId: this.#state.executionDecisionId,
                    executionMode: defaultMode,
                    autoConfirmed: true,
                };
            }
        }
        return {
            state: this.#state.state,
            revision: this.#state.revision,
            executionDecisionId: this.#state.executionDecisionId,
        };
    }

    async consumeExecutionDecision({ decisionId, mode } = {}) {
        this.#load();
        if (mode && !['INLINE', 'SUBAGENT_DRIVEN'].includes(mode)) {
            return { error: `invalid mode: ${mode}`, available: ['INLINE', 'SUBAGENT_DRIVEN'] };
        }
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
        const seenFp2 = new Set();
        try {
            for (const [taskId, info] of Object.entries(this.#state.tasks || {})) {
                if (info.status !== 'COMPLETED' || !info.filePath || !info.fileHash) continue;
                const current = fastFingerprint(info.filePath);
                if (!current) staleFiles.push(`${taskId}:${info.filePath} (missing)`);
                else if (current !== info.fileHash) staleFiles.push(`${taskId}:${info.filePath} (stale fingerprint)`);
                seenFp2.add(info.filePath);
            }
            for (const [fp, stored] of Object.entries(this.#state.fileFingerprints || {})) {
                if (seenFp2.has(fp)) continue;
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
            // 4.3: force requiere confirmación humana en últimas 5 entradas de audit
            const recentAudit = [...(this.#state.audit || []).slice(-5), ...this.#auditBuffer.slice(-5)];
            const hasHuman = recentAudit.some((e) => e.reasoning && /forzar|confirmo|force/i.test(e.reasoning));
            if (!hasHuman) {
                return {
                    error: 'force requires human confirmation',
                    pending,
                    staleFiles: staleFiles.length ? staleFiles : undefined,
                    current_state: this.#state.state,
                    attempted_transition: 'implementation_complete',
                    suggestion: 'User must write forzar/confirmo/force in a prior block/replan/set_handoff reasoning',
                };
            }
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
        const from = this.#state.state;
        const to = this.#isAllowedTransition(this.#state.state, 'block');
        if (!to) return this.#makeError(`Cannot block from state ${this.#state.state}`, 'block');
        // 1.9: block desde EXECUTING_* preserva tasks/fileFingerprints/expectedTasks y audita WARN
        const isExecuting = from === 'EXECUTING_INLINE' || from === 'EXECUTING_SUBAGENTS';
        await this.#transition(to, { error: reason || 'Blocked' });
        await this.#audit('BLOCKED', 'block', reason || 'no reason');
        if (isExecuting) {
            await this.#audit(
                'WARN',
                'block_from_executing',
                `block from ${from} preserved tasks: ${Object.keys(this.#state.tasks || {}).length}`
            );
        }
        // 10.6: increment subagentFailedCount if block reason indicates subagent failure
        if (reason && /subagent.*failed/i.test(reason)) {
            this.#state.subagentFailedCount = (this.#state.subagentFailedCount || 0) + 1;
            await this.#audit('WARN', 'subagent_failed', reason);
            try {
                await this.#persist();
            } catch {}
        }
        return { state: this.#state.state, revision: this.#state.revision };
    }

    async replan({ reason } = {}) {
        this.#load();
        // 1.9: replan desde EXECUTING_* rechazado sin limpiar tasks
        if (this.#state.state === 'EXECUTING_INLINE' || this.#state.state === 'EXECUTING_SUBAGENTS') {
            return this.#makeError(
                `Cannot replan from state ${this.#state.state} — replan only from BLOCKED`,
                'replan'
            );
        }
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
        const seenFp = new Set();
        try {
            for (const [taskId, info] of Object.entries(this.#state.tasks || {})) {
                if (info.status !== 'COMPLETED' || !info.filePath || !info.fileHash) continue;
                const current = fastFingerprint(info.filePath);
                if (!current) staleFiles.push(`${taskId}:${info.filePath} (missing)`);
                else if (current !== info.fileHash) staleFiles.push(`${taskId}:${info.filePath} (stale fingerprint)`);
                seenFp.add(info.filePath);
            }
            for (const [fp, stored] of Object.entries(this.#state.fileFingerprints || {})) {
                if (seenFp.has(fp)) continue;
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

    async getAudit({ limit = 20, offset = 0, phase, since } = {}) {
        this.#load();
        let all = this.#state.audit || [];
        if (phase) all = all.filter((e) => e.phase === phase);
        if (since) all = all.filter((e) => e.ts >= since);
        const slice = all.slice(Math.max(0, all.length - limit - offset), all.length - offset).reverse();
        return slice.map((e) => ({
            id: e.id,
            ts: e.ts,
            phase: e.phase,
            decision: e.decision,
            reasoning: e.reasoning ? String(e.reasoning).slice(0, 300) : undefined,
        }));
    }

    async getMetrics() {
        this.#load();
        let stateFileSize = 0;
        let auditSize = 0;
        let diskFreeMB = null;
        try {
            const stat = statSync(this.#statePath);
            stateFileSize = stat.size;
        } catch {}
        try {
            auditSize = (this.#state.audit || []).length;
        } catch {}
        try {
            // diskFree via statfs if available, fallback to null
            const { statfsSync } = await import('node:fs');
            if (typeof statfsSync === 'function' && this.#statePath) {
                try {
                    const s = statfsSync(dirname(this.#statePath));
                    diskFreeMB = Math.floor((s.bfree * s.bsize) / (1024 * 1024));
                } catch {}
            }
        } catch {}
        const completed = Object.values(this.#state.tasks || {}).filter((t) => t.status === 'COMPLETED').length;
        const total = Object.keys(this.#state.tasks || {}).length;
        const pending = Array.isArray(this.#state.expectedTasks)
            ? this.#state.expectedTasks.filter(
                  (id) => !this.#state.tasks[id] || this.#state.tasks[id].status !== 'COMPLETED'
              ).length
            : typeof this.#state.expectedTaskCount === 'number'
              ? Math.max(0, this.#state.expectedTaskCount - completed)
              : 0;
        return {
            revision: this.#state.revision,
            state: this.#state.state,
            degraded: this.#degraded || !!this.#state.degraded,
            consecutiveFailures: this.#consecutiveFailures,
            taskCounts: {
                completed,
                pending,
                total,
                expected: this.#state.expectedTaskCount ?? this.#state.expectedTasks?.length ?? null,
            },
            expectedTaskCount: this.#state.expectedTaskCount,
            auditSize,
            stateFileSize,
            diskFreeMB,
            uptimeMs: Date.now() - (this.#state.ts || Date.now()),
            stateOversizedCount: this.#state.stateOversizedCount || 0,
            codegraphBypassCount: this.#state.codegraphBypassCount || 0,
            degradedEditsCount: this.#state.degradedEditsCount || 0,
            cacheHitCount: this.#state.cacheHitCount || 0,
            cacheMissCount: this.#state.cacheMissCount || 0,
            tokenSavingEstimate: this.#state.tokenSavingEstimate || 0,
            sensitiveAccess: this.#state.sensitiveAccess || { allowed: 0, denied: 0, blockedAttempts: 0 },
            subagentFailedCount: this.#state.subagentFailedCount || 0,
            staleContentAttempts: this.#state.staleContentAttempts || 0,
            completeWithoutValidateCount: this.#state.completeWithoutValidateCount || 0,
            toolTimeoutCount: this.#state.toolTimeoutCount || 0,
            lastToolDurationMs: this.#state.lastToolDurationMs || 0,
            stateDurationMs: this.#state.stateDurationMs || 0,
        };
    }

    async _recordToolTimeout() {
        this.#load();
        this.#state.toolTimeoutCount = (this.#state.toolTimeoutCount || 0) + 1;
        this.#state.lastToolDurationMs = 5000;
        try {
            await this.#persist();
        } catch {}
    }

    async _recordToolDuration(ms) {
        this.#load();
        this.#state.lastToolDurationMs = ms;
        this.#state.stateDurationMs = Date.now() - (this.#state.ts || Date.now());
        try {
            await this.#persist();
        } catch {}
    }

    // --- 5.4 hardening-v2: cache metrics (token efficiency) ---
    async recordCacheHit({ tokensSaved = 500 } = {}) {
        this.#load();
        this.#state.cacheHitCount = (this.#state.cacheHitCount || 0) + 1;
        const saved = typeof tokensSaved === 'number' && tokensSaved > 0 ? tokensSaved : 500;
        this.#state.tokenSavingEstimate = (this.#state.tokenSavingEstimate || 0) + saved;
        try {
            await this.#persist();
        } catch {}
        return {
            ok: true,
            cacheHitCount: this.#state.cacheHitCount,
            tokenSavingEstimate: this.#state.tokenSavingEstimate,
        };
    }

    async recordCacheMiss() {
        this.#load();
        this.#state.cacheMissCount = (this.#state.cacheMissCount || 0) + 1;
        try {
            await this.#persist();
        } catch {}
        return { ok: true, cacheMissCount: this.#state.cacheMissCount };
    }

    async recordUserConfirmation({ decisionId, confirmationText } = {}) {
        this.#load();
        if (!decisionId || typeof confirmationText !== 'string') {
            return { error: 'decisionId and confirmationText required' };
        }
        await this.#audit(
            'CONFIRMATION',
            'record_user_confirmation',
            `user confirmed: ${confirmationText} for ${decisionId}`
        );
        await this.#flushAudit(true);
        await this.#persist();
        return { ok: true, decisionId, confirmationText, ts: Date.now() };
    }

    // --- D11: Credential guard helpers — source-of-truth is src/security.ts (hardening-v2 D1) ---
    isSensitiveFile(filePath) {
        if (!filePath) return false;
        this.#load();
        const patterns =
            (this.#state && this.#state.sensitivePatterns) || DEFAULT_STATE.sensitivePatterns || SENSITIVE_DEFAULT;
        return isSensitive(filePath, patterns);
    }

    async checkFileAccess({ filePath, reason } = {}) {
        this.#load();
        if (!filePath) return { error: 'filePath required' };
        if (!this.isSensitiveFile(filePath)) return { allowed: true, reason: 'not sensitive' };
        if (this.#state.allowedFiles?.[filePath]) return { allowed: true, reason: 'previously allowed' };
        if (this.#state.deniedFiles?.[filePath]) {
            return {
                error: `BLOCKED: File ${filePath} requires check_file_access (previously denied)`,
                denied: true,
                filePath,
            };
        }
        const decisionId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        if (!this.#state.pendingFileAccess) this.#state.pendingFileAccess = {};
        this.#state.pendingFileAccess[decisionId] = { filePath, reason, ts: Date.now() };
        await this.#audit('SECURITY', 'check_file_access', `check ${filePath} reason=${reason || 'none'}`);
        this.#state.sensitiveAccess = this.#state.sensitiveAccess || { allowed: 0, denied: 0, blockedAttempts: 0 };
        this.#state.sensitiveAccess.blockedAttempts = (this.#state.sensitiveAccess.blockedAttempts || 0) + 1;
        await this.#persist();
        return { status: 'BLOCKED', decisionId, filePath, reason: `File ${filePath} requires check_file_access` };
    }

    async consumeFileAccessDecision({ decisionId, choice } = {}) {
        this.#load();
        if (!decisionId || !choice) return { error: 'decisionId and choice required' };
        if (!['ALLOW', 'DENY'].includes(choice))
            return { error: 'choice must be ALLOW or DENY', available: ['ALLOW', 'DENY'] };
        const pending = this.#state.pendingFileAccess?.[decisionId];
        let filePath = pending?.filePath;
        // fallback: if no pending, try to find by decisionId prefix? require filePath param alternative
        if (!filePath && decisionId.startsWith('file-')) {
            // try to extract from audit? For now return error if not found
            return { error: 'decisionId not found', decisionId };
        }
        if (!this.#state.allowedFiles) this.#state.allowedFiles = {};
        if (!this.#state.deniedFiles) this.#state.deniedFiles = {};
        if (!this.#state.sensitiveAccess) this.#state.sensitiveAccess = { allowed: 0, denied: 0, blockedAttempts: 0 };
        if (choice === 'ALLOW') {
            this.#state.allowedFiles[filePath] = true;
            delete this.#state.deniedFiles[filePath];
            this.#state.sensitiveAccess.allowed = (this.#state.sensitiveAccess.allowed || 0) + 1;
            await this.#audit('SECURITY', 'consume_file_access_decision', `ALLOW ${filePath}`);
        } else {
            this.#state.deniedFiles[filePath] = true;
            delete this.#state.allowedFiles[filePath];
            this.#state.sensitiveAccess.denied = (this.#state.sensitiveAccess.denied || 0) + 1;
            await this.#audit('WARN', 'consume_file_access_decision', `DENY ${filePath}`);
        }
        if (this.#state.pendingFileAccess) delete this.#state.pendingFileAccess[decisionId];
        await this.#persist();
        return { ok: true, decisionId, choice, filePath };
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

    // --- O6: Validate edit with fast fingerprint + D6/D4 hard gate + 10.4 freshness ---
    async validateEdit({ oldString, newString, content, taskId, filePath } = {}) {
        this.#load();
        if (this.#state.state !== 'EXECUTING_INLINE' && this.#state.state !== 'EXECUTING_SUBAGENTS') {
            return { outcome: 'CONFLICT', reason: `Cannot validate edit from state ${this.#state.state}` };
        }
        if (taskId && !isValidTaskId(taskId)) {
            return { outcome: 'CONFLICT', reason: `invalid taskId: ${taskId}` };
        }
        if (filePath && !isPathInsideProject(filePath, this.#statePath)) {
            return { outcome: 'CONFLICT', reason: `filePath outside projectRoot: ${filePath}` };
        }
        // 9.2: guard sensible en validate_edit
        if (filePath && this.isSensitiveFile(filePath) && !this.#state.allowedFiles?.[filePath]) {
            return { outcome: 'CONFLICT', reason: `BLOCKED: File ${filePath} requires check_file_access` };
        }
        // 8.5: contar edits en degraded sin confirmación auditada
        if (this.#degraded) {
            this.#state.degradedEditsCount = (this.#state.degradedEditsCount || 0) + 1;
            try {
                await this.#persist();
            } catch {}
        }
        // 10.4: validación de frescura — content debe coincidir con disco si filePath dado
        if (filePath && typeof content === 'string') {
            try {
                const projectRoot = getProjectRoot(this.#statePath);
                const absolutePath =
                    filePath.startsWith('/') || /^[A-Za-z]:/.test(filePath)
                        ? resolve(filePath)
                        : resolve(projectRoot, filePath);
                const diskContent = readFileSync(absolutePath, 'utf8');
                if (diskContent !== content) {
                    this.#state.staleContentAttempts = (this.#state.staleContentAttempts || 0) + 1;
                    await this.#persist();
                    return { outcome: 'CONFLICT', reason: 'content stale, re-read file', filePath };
                }
            } catch (e) {
                if (e.code && e.code !== 'ENOENT') {
                    // ignore ENOENT (new file), but other errors considered stale
                }
            }
        }
        // 5.3: optimization — si fastFingerprint no cambió, no re-enviar content completo
        if (
            (typeof content !== 'string' || content.length === 0) &&
            filePath &&
            this.#state.lastValidated?.filePath === filePath
        ) {
            try {
                const projectRoot = getProjectRoot(this.#statePath);
                const absolutePath =
                    filePath.startsWith('/') || /^[A-Za-z]:/.test(filePath)
                        ? resolve(filePath)
                        : resolve(projectRoot, filePath);
                const currentHash = fastFingerprint(absolutePath);
                if (currentHash && currentHash === this.#state.lastValidated.hash) {
                    try {
                        const diskContent = readFileSync(absolutePath, 'utf8');
                        content = diskContent;
                    } catch {}
                }
            } catch {}
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
        // 10.5: ligadura validate → complete
        try {
            const projectRoot = getProjectRoot(this.#statePath);
            const absolutePath = filePath
                ? filePath.startsWith('/') || /^[A-Za-z]:/.test(filePath)
                    ? resolve(filePath)
                    : resolve(projectRoot, filePath)
                : null;
            const hash = absolutePath ? fastFingerprint(absolutePath) : null;
            this.#state.lastValidated = { filePath: filePath || null, hash, ts: Date.now() };
            await this.#persist();
        } catch {}
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
        if (!isValidTaskId(taskId)) return { error: 'invalid taskId: must match /^[a-zA-Z0-9-_.\/:]+$/', taskId };
        if (filePath && !isPathInsideProject(filePath, this.#statePath)) {
            return { error: 'filePath outside projectRoot', filePath };
        }
        // 9.2: guard de credenciales — rechazar sensibles sin ALLOW
        if (filePath && this.isSensitiveFile(filePath) && !this.#state.allowedFiles?.[filePath]) {
            return { error: `BLOCKED: File ${filePath} requires check_file_access`, filePath };
        }
        if (!this.#state.tasks) this.#state.tasks = {};

        // O6: Use fast fingerprint if no hash provided
        const effectiveHash = fileHash || (filePath ? fastFingerprint(filePath) : null);
        // 1.6: fingerprint obligatorio si archivo existe
        if (filePath) {
            const existsCheck = fastFingerprint(filePath);
            if (existsCheck && !effectiveHash) {
                return { error: 'fingerprint required: file exists but fileHash is null' };
            }
        }
        // 10.5: ligadura validate → complete — WARN si no hubo validate previo
        if (!this.#state.lastValidated || (filePath && this.#state.lastValidated.filePath !== filePath)) {
            this.#state.completeWithoutValidateCount = (this.#state.completeWithoutValidateCount || 0) + 1;
            await this.#audit(
                'WARN',
                'complete_without_validate',
                `complete_task without prior validate_edit for ${filePath || taskId}`
            );
        } else {
            this.#state.lastValidated = null;
        }

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
        // 1.8: preservación de handoff manual reciente (<60s) con pendingTasks distintos
        if (totalCompleted % 3 === 0) {
            const pendingForHandoff = Array.isArray(this.#state.expectedTasks)
                ? this.#state.expectedTasks.filter(
                      (id) => !this.#state.tasks[id] || this.#state.tasks[id].status !== 'COMPLETED'
                  )
                : [];
            const existing = this.#state.lastHandoff;
            const isRecentManual =
                existing &&
                Date.now() - existing.ts < 60000 &&
                existing.summary &&
                !existing.summary.startsWith('Checkpoint auto');
            let shouldOverwrite = true;
            if (isRecentManual) {
                const existingPending = existing.pendingTasks || [];
                const isDistinct =
                    pendingForHandoff.length !== existingPending.length ||
                    pendingForHandoff.some((id) => !existingPending.includes(id));
                if (isDistinct && existingPending.length > 0) {
                    shouldOverwrite = false;
                }
            }
            if (shouldOverwrite) {
                this.#state.lastHandoff = {
                    ts: Date.now(),
                    summary: `Checkpoint auto: ${totalCompleted} tasks completadas`,
                    nextSteps: pendingForHandoff.length ? [`Continuar con ${pendingForHandoff.join(', ')}`] : [],
                    pendingTasks: pendingForHandoff,
                };
            }
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
                if (e.reasoning && SENSITIVE_REDACT_RE.test(e.reasoning))
                    e.reasoning = e.reasoning.replace(SENSITIVE_REDACT_RE, '[REDACTED]');
            }
            this.#state.audit.push(...this.#auditBuffer);
            const retention = getAuditRetentionSafe();
            if (this.#state.audit.length > retention) this.#state.audit = this.#state.audit.slice(-retention);
            this.#auditBuffer = [];
        }
        // T1: final persist path kept synchronous for graceful shutdown (+ D2 stale-aware 15s)
        if (!this.#statePath || !this.#state || !this.#loaded) return;
        try {
            // D2: replicate staleWindow logic sync — check timestamp before acquiring
            try {
                const tsRaw = readFileSync(this.#lockHeartbeatPath, 'utf8');
                const age = Date.now() - parseInt(tsRaw, 10);
                if (!Number.isNaN(age) && age >= 15000) {
                    try {
                        unlinkSync(this.#lockPidPath);
                    } catch {}
                    try {
                        unlinkSync(this.#lockHeartbeatPath);
                    } catch {}
                    this.#lockOwner = false;
                } else if (!Number.isNaN(age) && age < 15000) {
                    try {
                        const pidRaw = readFileSync(this.#lockPidPath, 'utf8').trim();
                        if (pidRaw !== String(process.pid)) return;
                    } catch {}
                }
            } catch {}
            try {
                writeFileSync(this.#lockPidPath, String(process.pid), { encoding: 'utf8', flag: 'wx' });
            } catch (e) {
                if (e && e.code === 'EEXIST') {
                    try {
                        const tsRaw2 = readFileSync(this.#lockHeartbeatPath, 'utf8');
                        const age2 = Date.now() - parseInt(tsRaw2, 10);
                        if (!Number.isNaN(age2) && age2 >= 15000) {
                            try {
                                unlinkSync(this.#lockPidPath);
                            } catch {}
                            try {
                                unlinkSync(this.#lockHeartbeatPath);
                            } catch {}
                            writeFileSync(this.#lockPidPath, String(process.pid), { encoding: 'utf8', flag: 'wx' });
                        } else return;
                    } catch {
                        return;
                    }
                } else throw e;
            }
            try {
                writeFileSync(this.#lockPidPath, String(process.pid), { encoding: 'utf8', flag: 'wx' });
                this.#heartbeatLock();
                this.#lockOwner = true;
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
 * Supports configurable retry with exponential backoff for transient failures.
 * @param {Function} fn - The tool handler function
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum retry attempts (default: 0)
 * @param {number} options.baseTimeout - Base timeout in ms (default: 5000)
 */
function safeHandler(fn, options = {}) {
    const { maxRetries = 0, baseTimeout = 5000 } = options;

    return async (params) => {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const currentTimeout = baseTimeout * Math.pow(1.5, attempt);
            const start = Date.now();
            try {
                const result = await Promise.race([
                    fn(params),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error(`timeout ${currentTimeout}ms`)), currentTimeout)
                    ),
                ]);
                const duration = Date.now() - start;
                try {
                    await controller._recordToolDuration(duration);
                } catch {}
                // Update heartbeat on successful completion
                controller.updateHeartbeat();
                return { content: [{ type: 'text', text: safeJsonStringify(result) }] };
            } catch (error) {
                const isTimeout = error && error.message && error.message.includes('timeout');
                const isNetworkError =
                    error && error.code && ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(error.code);
                const isRetryable = isTimeout || isNetworkError;

                if (isRetryable && attempt < maxRetries) {
                    const backoff = 200 * Math.pow(2, attempt);
                    log('warn:tool_retry', {
                        tool: fn.name || 'anonymous',
                        attempt: attempt + 1,
                        maxRetries,
                        error: error.message,
                        backoff,
                    });
                    await sleep(backoff);
                    continue; // retry
                }

                if (isTimeout) {
                    log('warn:tool_timeout', { tool: fn.name || 'anonymous', durationMs: currentTimeout });
                    try {
                        await controller._recordToolTimeout();
                    } catch {}
                    return {
                        content: [
                            {
                                type: 'text',
                                text: safeJsonStringify({ error: `timeout ${currentTimeout}ms`, degraded: true }),
                            },
                        ],
                        isError: true,
                    };
                }

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
        }
    };
}

const server = new McpServer({
    name: 'ostacky-controller',
    version: '0.7.4',
});

server.registerTool(
    'start_request',
    {
        description:
            'Start or resume a request. By default, resumes in-progress work (non-terminal states). Use force=true to always reset.',
        inputSchema: z.object({
            requestId: z.string().optional().describe('Unique request ID'),
            changeId: z.string().optional().describe('Optional change ID for OpenSpec tracking'),
            force: z.boolean().optional().describe('Force reset even if work in progress (default: false)'),
        }),
    },
    safeHandler(async ({ requestId, changeId, force }) => {
        log('tool:start_request', { force: !!force });
        return await controller.startRequest({ requestId, changeId, force: !!force });
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
    safeHandler(
        async () => {
            log('tool:verify_integrity');
            return await controller.verifyIntegrity();
        },
        { maxRetries: 1 }
    )
);

server.registerTool(
    'get_audit',
    {
        description: 'Get recent audit entries paginated. Read-only, truncated to 300 chars with unique id per entry.',
        inputSchema: z.object({
            limit: z.number().optional().describe('Max entries (default 20)'),
            offset: z.number().optional().describe('Offset from end (default 0)'),
            phase: z.string().optional().describe('Filter by phase (e.g. WARN, LEVEL_RESOLVED)'),
            since: z.number().optional().describe('Filter by timestamp >= since'),
        }),
    },
    safeHandler(
        async ({ limit, offset, phase, since }) => {
            log('tool:get_audit', { limit, offset, phase, since });
            return await controller.getAudit({ limit, offset, phase, since });
        },
        { maxRetries: 1 }
    )
);

server.registerTool(
    'get_metrics',
    {
        description:
            'Get controller metrics read-only (revision, state, degraded, taskCounts, auditSize, stateFileSize, diskFreeMB, uptimeMs, stateOversizedCount, codegraphBypassCount)',
        inputSchema: z.object({}),
    },
    safeHandler(
        async () => {
            log('tool:get_metrics');
            return await controller.getMetrics();
        },
        { maxRetries: 1 }
    )
);

server.registerTool(
    'record_cache_hit',
    {
        description:
            'Record a CodeGraph cache hit — increments cacheHitCount and tokenSavingEstimate. Call after reusing getCachedCodegraph result.',
        inputSchema: z.object({
            tokensSaved: z.number().optional().describe('Estimated tokens saved (default 500)'),
        }),
    },
    safeHandler(async ({ tokensSaved }) => {
        log('tool:record_cache_hit', { tokensSaved });
        return await controller.recordCacheHit({ tokensSaved });
    })
);

server.registerTool(
    'record_cache_miss',
    {
        description:
            'Record a CodeGraph cache miss — increments cacheMissCount. Call after getCachedCodegraph returns null.',
        inputSchema: z.object({}),
    },
    safeHandler(async () => {
        log('tool:record_cache_miss');
        return await controller.recordCacheMiss();
    })
);

server.registerTool(
    'record_user_confirmation',
    {
        description:
            'Record user confirmation with decisionId and literal text. Required for force and human-in-the-loop gates.',
        inputSchema: z.object({
            decisionId: z.string().describe('Decision ID from pending state'),
            confirmationText: z.string().describe('Literal user confirmation text'),
        }),
    },
    safeHandler(async ({ decisionId, confirmationText }) => {
        log('tool:record_user_confirmation', { decisionId });
        return await controller.recordUserConfirmation({ decisionId, confirmationText });
    })
);

server.registerTool(
    'check_file_access',
    {
        description:
            'Check if file is sensitive and requires ALLOW. Returns BLOCKED with decisionId if sensitive and not allowed.',
        inputSchema: z.object({
            filePath: z.string().describe('File path to check'),
            reason: z.string().optional().describe('Reason for access'),
        }),
    },
    safeHandler(async ({ filePath, reason }) => {
        log('tool:check_file_access', { filePath });
        return await controller.checkFileAccess({ filePath, reason });
    })
);

server.registerTool(
    'consume_file_access_decision',
    {
        description: 'Consume file access decision: ALLOW or DENY. Persists allowedFiles/deniedFiles.',
        inputSchema: z.object({
            decisionId: z.string().describe('Decision ID from check_file_access'),
            choice: z.enum(['ALLOW', 'DENY']).describe('Choice'),
        }),
    },
    safeHandler(async ({ decisionId, choice }) => {
        log('tool:consume_file_access_decision', { decisionId, choice });
        return await controller.consumeFileAccessDecision({ decisionId, choice });
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
    safeHandler(
        async () => {
            const state = await controller.getState();
            const metrics = await controller.getMetrics().catch(() => ({}));
            return {
                pong: true,
                degraded: controller.degraded,
                state: {
                    state: state.state,
                    revision: state.revision,
                    requestId: state.requestId,
                },
                diskFreeMB: metrics.diskFreeMB ?? null,
                stateFileSize: metrics.stateFileSize ?? null,
                auditSize: metrics.auditSize ?? null,
            };
        },
        { maxRetries: 1 }
    )
);

server.registerTool(
    'get_state',
    {
        description: 'Get the current controller state (reads persistent store).',
        inputSchema: z.object({}),
    },
    safeHandler(
        async () => {
            return await controller.getState();
        },
        { maxRetries: 1 }
    )
);

server.registerTool(
    'get_tasks',
    {
        description: 'Get current task states.',
        inputSchema: z.object({}),
    },
    safeHandler(
        async () => {
            return await controller.getTasks();
        },
        { maxRetries: 1 }
    )
);

server.registerTool(
    'get_available_transitions',
    {
        description: 'Get valid transitions from current state. Useful for debugging state machine issues.',
        inputSchema: z.object({}),
    },
    safeHandler(
        async () => {
            return await controller.getAvailableTransitions();
        },
        { maxRetries: 1 }
    )
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
    safeHandler(
        async () => {
            return await controller.getHandoff();
        },
        { maxRetries: 1 }
    )
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
    safeHandler(
        async () => {
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
        },
        { maxRetries: 1 }
    )
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
            filePath: z.string().optional().describe('Optional file path for traversal validation.'),
        }),
    },
    safeHandler(async ({ oldString, newString, content, taskId, filePath }) => {
        log('tool:validate_edit', {
            taskId,
            oldLen: oldString?.length,
            newLen: newString?.length,
            hasContent: !!content,
            filePath,
        });
        if (typeof content !== 'string' || typeof oldString !== 'string' || typeof newString !== 'string') {
            return {
                outcome: 'CONFLICT',
                reason: 'Missing required fields: content, oldString, and newString are all required. Read the file first, then pass content to validate_edit.',
            };
        }
        return await controller.validateEdit({ oldString, newString, content, taskId, filePath });
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
    log('Starting ostacky-controller MCP v0.7.4...');
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
