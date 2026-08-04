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
import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, basename, join, resolve } from 'node:path';

const MAX_TASKS = 50;
const MAX_SNAPSHOT_JSON_LENGTH = 100 * 1024;
const MAX_STATE_FILE_SIZE = 1024 * 1024;

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
        { via: 'analysis_complete', to: 'EXECUTION_DECISION_PENDING' },
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

/**
 * Safe JSON.stringify that won't throw on circular references.
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
 * Cleans up stale .tmp.* files from a previous crash.
 */
function cleanupTmpFiles(statePath) {
    if (!statePath) return;
    const dir = dirname(statePath);
    const name = basename(statePath);
    try {
        for (const entry of readdirSync(dir)) {
            if (entry.startsWith(name + '.tmp.')) {
                try {
                    unlinkSync(join(dir, entry));
                } catch {
                    /* best-effort */
                }
            }
        }
    } catch {
        /* directory may not exist yet */
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
    executionDecisionId: null,
    executionMode: null,
    snapshots: { codegraph: null, execution: null },
    tasks: {},
    fileFingerprints: {},
    error: null,
});

class OstackyController {
    #statePath;
    #state;
    #loaded;

    constructor(opts = {}) {
        this.#statePath = opts.statePath;
        if (opts.initialState) {
            this.#state = { ...DEFAULT_STATE, ...opts.initialState };
            this.#loaded = true;
        } else {
            this.#state = null;
            this.#loaded = false;
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

    #persist() {
        if (!this.#statePath) return;
        const dir = dirname(this.#statePath);
        mkdirSync(dir, { recursive: true });
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
        writeFileSync(tmp, serialized, 'utf8');
        renameSync(tmp, this.#statePath);
        try {
            const backupTmp = this.#statePath + '.backup.tmp.' + process.pid;
            writeFileSync(backupTmp, serialized, 'utf8');
            renameSync(backupTmp, this.#statePath + '.backup');
        } catch {
            /* backup is best-effort */
        }
    }

    /**
     * Trims old completed tasks when we exceed MAX_TASKS.
     * Keeps the most recent MAX_TASKS entries.
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

    #transition(to, changes = {}) {
        this.#state.revision++;
        this.#state.state = to;
        Object.assign(this.#state, changes);
        this.#persist();
    }

    #isAllowedTransition(from, via, choiceOrMode) {
        const transitions = TRANSITIONS[from] || [];
        for (const t of transitions) {
            if (t.via !== via) continue;
            if (t.choice !== undefined && t.choice !== choiceOrMode) continue;
            if (t.mode !== undefined && t.mode !== choiceOrMode) continue;
            return t.to;
        }
        return null;
    }

    async startRequest({ requestId, changeId } = {}) {
        this.#load();
        if (this.#state.state === 'INTERPRETATION_PENDING' && !requestId) {
            return { state: this.#state.state, revision: this.#state.revision, requestId: this.#state.requestId };
        }
        this.#transition('INTERPRETATION_PENDING', {
            requestId: requestId || 'req-' + Date.now(),
            changeId: changeId || null,
            routeDecisionId: null,
            routeChoice: null,
            executionDecisionId: null,
            executionMode: null,
            snapshots: { codegraph: null, execution: null },
            tasks: {},
            fileFingerprints: {},
            error: null,
        });
        return { state: this.#state.state, revision: this.#state.revision, requestId: this.#state.requestId };
    }

    async requestClarification({ question } = {}) {
        this.#load();
        const to = this.#isAllowedTransition(this.#state.state, 'request_clarification');
        if (!to) return { error: `Cannot request clarification from state ${this.#state.state}` };
        this.#transition(to, { error: question ? `Clarification: ${question}` : null });
        return { state: this.#state.state, revision: this.#state.revision };
    }

    async recordClarification() {
        this.#load();
        const to = this.#isAllowedTransition(this.#state.state, 'record_clarification');
        if (!to) return { error: `Cannot record clarification from state ${this.#state.state}` };
        this.#transition(to, { error: null });
        return { state: this.#state.state, revision: this.#state.revision };
    }

    async recordDiscovery({ level, routeDecisionId, snapshot } = {}) {
        this.#load();
        const to = this.#isAllowedTransition(this.#state.state, 'record_discovery');
        if (!to) return { error: `Cannot record discovery from state ${this.#state.state}` };
        if (snapshot && safeJsonStringify(snapshot).length > MAX_SNAPSHOT_JSON_LENGTH) {
            return { error: `Snapshot exceeds maximum size of ${MAX_SNAPSHOT_JSON_LENGTH} bytes` };
        }
        this.#transition(to, {
            routeDecisionId: routeDecisionId || 'route-' + Date.now(),
            routeChoice: null,
            snapshots: { ...this.#state.snapshots, codegraph: snapshot || this.#state.snapshots.codegraph },
        });
        const defaultChoice = level === '1+' ? 'SPEC' : 'DIRECT';
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
        if (!to) return { error: `Cannot proceed to route from state ${this.#state.state}` };
        this.#transition(to);
        return { state: this.#state.state, revision: this.#state.revision };
    }

    async abandon({ reason } = {}) {
        this.#load();
        const to = this.#isAllowedTransition(this.#state.state, 'abandon');
        if (!to) return { error: `Cannot abandon from state ${this.#state.state}` };
        this.#transition(to, { error: reason || 'Abandoned' });
        return { state: this.#state.state, revision: this.#state.revision };
    }

    async consumeRouteDecision({ decisionId, choice } = {}) {
        this.#load();
        if (this.#state.state !== 'ROUTE_DECISION_PENDING') {
            return { error: `Cannot consume route decision from state ${this.#state.state}` };
        }
        if (this.#state.routeDecisionId !== decisionId) return { error: `Decision ID mismatch` };
        const to = this.#isAllowedTransition(this.#state.state, 'consume_route_decision', choice);
        if (!to) return { error: `Route ${choice} not allowed from ${this.#state.state}` };
        this.#transition(to, { routeChoice: choice });
        return { state: this.#state.state, revision: this.#state.revision, routeChoice: choice };
    }

    async specComplete() {
        this.#load();
        const to = this.#isAllowedTransition(this.#state.state, 'spec_complete');
        if (!to) return { error: `Cannot complete spec from state ${this.#state.state}` };
        this.#transition(to);
        return { state: this.#state.state, revision: this.#state.revision };
    }

    async recordExecutionAnalysis({ executionDecisionId, snapshot } = {}) {
        this.#load();
        const to = this.#isAllowedTransition(this.#state.state, 'analysis_complete');
        if (!to) return { error: `Cannot record execution analysis from state ${this.#state.state}` };
        if (snapshot && safeJsonStringify(snapshot).length > MAX_SNAPSHOT_JSON_LENGTH) {
            return { error: `Snapshot exceeds maximum size of ${MAX_SNAPSHOT_JSON_LENGTH} bytes` };
        }
        this.#transition(to, {
            executionDecisionId: executionDecisionId || 'exec-' + Date.now(),
            executionMode: null,
            snapshots: { ...this.#state.snapshots, execution: snapshot || null },
        });
        return {
            state: this.#state.state,
            revision: this.#state.revision,
            executionDecisionId: this.#state.executionDecisionId,
        };
    }

    async consumeExecutionDecision({ decisionId, mode } = {}) {
        this.#load();
        if (this.#state.state !== 'EXECUTION_DECISION_PENDING') {
            return { error: `Cannot consume execution decision from state ${this.#state.state}` };
        }
        if (this.#state.executionDecisionId !== decisionId) return { error: `Decision ID mismatch` };
        const to = this.#isAllowedTransition(this.#state.state, 'consume_execution_decision', mode);
        if (!to) return { error: `Mode ${mode} not allowed from ${this.#state.state}` };
        this.#transition(to, { executionMode: mode });
        return { state: this.#state.state, revision: this.#state.revision, executionMode: mode };
    }

    async implementationComplete() {
        this.#load();
        const to = this.#isAllowedTransition(this.#state.state, 'implementation_complete');
        if (!to) return { error: `Cannot complete implementation from state ${this.#state.state}` };
        this.#transition(to);
        return { state: this.#state.state, revision: this.#state.revision };
    }

    async syncComplete() {
        this.#load();
        const to = this.#isAllowedTransition(this.#state.state, 'sync_complete');
        if (!to) return { error: `Cannot complete sync from state ${this.#state.state}` };
        this.#transition(to);
        return { state: this.#state.state, revision: this.#state.revision };
    }

    async block({ reason } = {}) {
        this.#load();
        const to = this.#isAllowedTransition(this.#state.state, 'block');
        if (!to) return { error: `Cannot block from state ${this.#state.state}` };
        this.#transition(to, { error: reason || 'Blocked' });
        return { state: this.#state.state, revision: this.#state.revision };
    }

    async replan({ reason } = {}) {
        this.#load();
        const to = this.#isAllowedTransition(this.#state.state, 'replan');
        if (!to) return { error: `Cannot replan from state ${this.#state.state}` };
        this.#transition(to, {
            error: reason || null,
            routeDecisionId: null,
            routeChoice: null,
            executionDecisionId: null,
            executionMode: null,
            snapshots: { codegraph: null, execution: null },
            tasks: {},
            fileFingerprints: {},
        });
        return { state: this.#state.state, revision: this.#state.revision };
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

    /**
     * Validates an edit against the current file content.
     * Returns one of: EDITABLE, ALREADY_APPLIED, CONFLICT.
     * - EDITABLE: oldString found exactly once, safe to replace.
     * - ALREADY_APPLIED: newString already present in content (idempotent skip).
     * - CONFLICT: oldString not found, or found multiple times.
     */
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
            return { error: `Cannot complete task from state ${this.#state.state}` };
        }
        if (!taskId) return { error: 'taskId is required' };
        if (!this.#state.tasks) this.#state.tasks = {};
        this.#state.tasks[taskId] = {
            status: 'COMPLETED',
            completedAt: new Date().toISOString(),
            filePath: filePath || null,
            fileHash: fileHash || null,
        };
        if (filePath && fileHash) {
            if (!this.#state.fileFingerprints) this.#state.fileFingerprints = {};
            this.#state.fileFingerprints[filePath] = fileHash;
        }
        this.#trimTasks();
        this.#persist();
        return {
            taskId,
            status: 'COMPLETED',
            totalCompleted: Object.keys(this.#state.tasks).filter((k) => this.#state.tasks[k].status === 'COMPLETED')
                .length,
        };
    }

    /**
     * Public flush — force-persists current state to disk.
     * Used by graceful shutdown (private fields not accessible from outside).
     */
    flush() {
        this.#persist();
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
    version: '0.6.1',
});

server.registerTool(
    'start_request',
    {
        description: 'Start or reset a new request. Can be called from ANY state — resets state machine. Call this first.',
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
        description: 'Record that clarification was requested. Transitions to CLARIFICATION_PENDING.',
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
        description: 'Record discovery complete with level classification. From INTERPRETATION_PENDING goes to ROUTE_DECISION_PENDING. From DISCOVERY goes to LEVEL_RESOLVED.',
        inputSchema: z.object({
            level: z.enum(['0', '0+1', '1+']).describe('Impact level'),
            routeDecisionId: z.string().optional().describe('Unique route decision ID'),
            snapshot: z.any().optional().describe('Optional CodeGraph snapshot'),
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
        description: 'Mark implementation as complete. Transitions to SYNC.',
        inputSchema: z.object({}),
    },
    safeHandler(async () => {
        log('tool:implementation_complete');
        return await controller.implementationComplete();
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
    'proceed_to_route',
    {
        description: 'Proceed from LEVEL_RESOLVED to ROUTE_DECISION_PENDING after discovery is confirmed.',
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
        description: 'Health check — returns pong if controller is alive. Use this to verify controller availability before making other calls.',
        inputSchema: z.object({}),
    },
    safeHandler(async () => {
        return {
            pong: true,
            state: await controller.getState().then(s => ({
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
        const pendingStates = [
            'CLARIFICATION_PENDING',
            'ROUTE_DECISION_PENDING',
            'EXECUTION_DECISION_PENDING',
        ];
        if (pendingStates.includes(state.state)) {
            return {
                status: 'BLOCKED',
                state: state.state,
                revision: state.revision,
                reason: `Cannot execute tools while in ${state.state}. Wait for user response first.`,
            };
        }
        return { status: 'ALLOW', state: state.state, revision: state.revision };
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
            fileHash: z.string().optional().describe('Optional SHA-256 hash of the file after modification.'),
        }),
    },
    safeHandler(async ({ taskId, filePath, fileHash }) => {
        log('tool:complete_task', { taskId, filePath });
        return await controller.completeTask({ taskId, filePath, fileHash });
    })
);

/**
 * Graceful shutdown: clean up tmp files and flush state.
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
        // Clean up own tmp files
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
    log('Starting ostacky-controller MCP...');
    log('State path:', { path: statePath });
    // Clean up stale tmp files from previous runs
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

export { OstackyController };
