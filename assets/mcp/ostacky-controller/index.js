#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function log(event, data) {
    const ts = new Date().toISOString();
    const payload = data ? ` ${JSON.stringify(data)}` : '';
    console.error(`[${ts}] ${event}${payload}`);
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
        this.#state = opts.initialState ? { ...DEFAULT_STATE, ...opts.initialState } : null;
        this.#loaded = false;
    }

    #load() {
        if (this.#loaded) return;
        if (!this.#statePath) {
            this.#state = { ...DEFAULT_STATE };
            this.#loaded = true;
            return;
        }
        try {
            const raw = readFileSync(this.#statePath, 'utf8');
            this.#state = { ...DEFAULT_STATE, ...JSON.parse(raw) };
        } catch {
            this.#state = { ...DEFAULT_STATE };
        }
        this.#loaded = true;
    }

    #persist() {
        if (!this.#statePath) return;
        const dir = dirname(this.#statePath);
        mkdirSync(dir, { recursive: true });
        const tmp = this.#statePath + '.tmp.' + process.pid;
        writeFileSync(tmp, JSON.stringify(this.#state, null, 2), 'utf8');
        renameSync(tmp, this.#statePath);
    }

    #transition(to, changes = {}) {
        this.#state.revision++;
        this.#state.state = to;
        Object.assign(this.#state, changes);
        this.#persist();
    }

    #isAllowedTransition(from, via, choiceOrMode) {
        const table = {
            INTERPRETATION_PENDING: [
                { to: 'CLARIFICATION_PENDING', via: 'request_clarification' },
                { to: 'DISCOVERY', via: 'proceed_to_discovery' },
                { to: 'ROUTE_DECISION_PENDING', via: 'record_discovery' },
                { to: 'BLOCKED', via: 'block' },
            ],
            CLARIFICATION_PENDING: [
                { to: 'DISCOVERY', via: 'record_clarification' },
                { to: 'BLOCKED', via: 'block' },
                { to: 'BLOCKED', via: 'abandon' },
            ],
            DISCOVERY: [
                { to: 'LEVEL_RESOLVED', via: 'record_discovery' },
                { to: 'BLOCKED', via: 'block' },
                { to: 'BLOCKED', via: 'abandon' },
            ],
            LEVEL_RESOLVED: [
                { to: 'ROUTE_DECISION_PENDING', via: 'route_decision_pending' },
                { to: 'BLOCKED', via: 'block' },
            ],
            ROUTE_DECISION_PENDING: [
                { to: 'SPECIFICATION', via: 'consume_route_decision', choice: 'SPEC' },
                { to: 'EXECUTION_ANALYSIS', via: 'consume_route_decision', choice: 'DIRECT' },
                { to: 'BLOCKED', via: 'block' },
            ],
            SPECIFICATION: [
                { to: 'EXECUTION_ANALYSIS', via: 'spec_complete' },
                { to: 'BLOCKED', via: 'block' },
                { to: 'BLOCKED', via: 'abandon' },
            ],
            EXECUTION_ANALYSIS: [
                { to: 'EXECUTION_DECISION_PENDING', via: 'analysis_complete' },
                { to: 'BLOCKED', via: 'block' },
                { to: 'BLOCKED', via: 'abandon' },
            ],
            EXECUTION_DECISION_PENDING: [
                { to: 'EXECUTING_INLINE', via: 'consume_execution_decision', mode: 'INLINE' },
                { to: 'EXECUTING_SUBAGENTS', via: 'consume_execution_decision', mode: 'SUBAGENT_DRIVEN' },
                { to: 'BLOCKED', via: 'block' },
            ],
            EXECUTING_INLINE: [
                { to: 'SYNC', via: 'implementation_complete' },
                { to: 'BLOCKED', via: 'block' },
            ],
            EXECUTING_SUBAGENTS: [
                { to: 'SYNC', via: 'implementation_complete' },
                { to: 'BLOCKED', via: 'block' },
            ],
            BLOCKED: [
                { to: 'INTERPRETATION_PENDING', via: 'replan' },
                { to: 'DONE', via: 'abandon' },
            ],
            SYNC: [
                { to: 'DONE', via: 'sync_complete' },
                { to: 'BLOCKED', via: 'block' },
            ],
            DONE: [],
        };
        const transitions = table[from] || [];
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
        if (
            this.#state.state !== 'INTERPRETATION_PENDING' &&
            this.#state.state !== 'BLOCKED' &&
            this.#state.state !== 'DONE'
        ) {
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
        if (!['0', '0+1', '1+'].includes(level)) return { error: `Invalid level: ${level}` };
        this.#transition('ROUTE_DECISION_PENDING', {
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

    async consumeRouteDecision({ decisionId, choice } = {}) {
        this.#load();
        if (this.#state.state !== 'ROUTE_DECISION_PENDING') {
            if (this.#state.routeDecisionId === decisionId && this.#state.routeChoice) {
                return { error: `Route decision ${decisionId} already consumed as ${this.#state.routeChoice}` };
            }
            return { error: `Cannot consume route decision from state ${this.#state.state}` };
        }
        if (this.#state.routeDecisionId !== decisionId) return { error: `Decision ID mismatch` };
        if (choice !== 'SPEC' && choice !== 'DIRECT') return { error: `Invalid choice: ${choice}` };
        if (this.#state.routeChoice) return { error: `Decision already consumed as ${this.#state.routeChoice}` };
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
        this.#transition('EXECUTION_DECISION_PENDING', {
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
            if (this.#state.executionDecisionId === decisionId && this.#state.executionMode) {
                return { error: `Execution decision ${decisionId} already consumed as ${this.#state.executionMode}` };
            }
            return { error: `Cannot consume execution decision from state ${this.#state.state}` };
        }
        if (this.#state.executionDecisionId !== decisionId) return { error: `Decision ID mismatch` };
        if (mode !== 'INLINE' && mode !== 'SUBAGENT_DRIVEN') return { error: `Invalid mode: ${mode}` };
        if (this.#state.executionMode) return { error: `Decision already consumed as ${this.#state.executionMode}` };
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
        return { ...this.#state };
    }

    async getTasks() {
        this.#load();
        return { ...this.#state.tasks };
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
                return { outcome: 'ALREADY_APPLIED', taskId, reason: 'oldString not found but newString is present — edit was already applied' };
            }
            return { outcome: 'CONFLICT', reason: 'oldString not found in content — file was modified externally' };
        }
        if (oldCount > 1) {
            return { outcome: 'CONFLICT', reason: `oldString found ${oldCount} times — need more context to disambiguate` };
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
        this.#persist();
        return { taskId, status: 'COMPLETED', totalCompleted: Object.keys(this.#state.tasks).filter(k => this.#state.tasks[k].status === 'COMPLETED').length };
    }
}

const statePath = process.env.OSTACKY_STATE_PATH || '.opencode/ostacky-state.json';
const controller = new OstackyController({ statePath });

const server = new McpServer({
    name: 'ostacky-controller',
    version: '0.5.6',
});

server.registerTool(
    'start_request',
    {
        description: 'Start or resume a new request in the state machine. Call this first.',
        inputSchema: z.object({
            requestId: z.string().optional().describe('Unique request ID'),
            changeId: z.string().optional().describe('Optional change ID for OpenSpec tracking'),
        }),
    },
    async ({ requestId, changeId }) => {
        log('tool:start_request');
        const result = await controller.startRequest({ requestId, changeId });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
);

server.registerTool(
    'request_clarification',
    {
        description: 'Record that clarification was requested. Transitions to CLARIFICATION_PENDING.',
        inputSchema: z.object({
            question: z.string().optional().describe('The clarification question'),
        }),
    },
    async ({ question }) => {
        log('tool:request_clarification');
        const result = await controller.requestClarification({ question });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
);

server.registerTool(
    'record_clarification',
    {
        description: 'Record that clarification was answered. Transitions to DISCOVERY.',
        inputSchema: z.object({}),
    },
    async () => {
        log('tool:record_clarification');
        const result = await controller.recordClarification();
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
);

server.registerTool(
    'record_discovery',
    {
        description: 'Record discovery complete with level classification. Transitions to ROUTE_DECISION_PENDING.',
        inputSchema: z.object({
            level: z.enum(['0', '0+1', '1+']).describe('Impact level'),
            routeDecisionId: z.string().optional().describe('Unique route decision ID'),
            snapshot: z.any().optional().describe('Optional CodeGraph snapshot'),
        }),
    },
    async ({ level, routeDecisionId, snapshot }) => {
        log('tool:record_discovery', { level });
        const result = await controller.recordDiscovery({ level, routeDecisionId, snapshot });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
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
    async ({ decisionId, choice }) => {
        log('tool:consume_route_decision', { choice });
        const result = await controller.consumeRouteDecision({ decisionId, choice });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
);

server.registerTool(
    'spec_complete',
    {
        description: 'Mark specification phase as complete. Transitions to EXECUTION_ANALYSIS.',
        inputSchema: z.object({}),
    },
    async () => {
        log('tool:spec_complete');
        const result = await controller.specComplete();
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
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
    async ({ executionDecisionId, snapshot }) => {
        log('tool:record_execution_analysis');
        const result = await controller.recordExecutionAnalysis({ executionDecisionId, snapshot });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
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
    async ({ decisionId, mode }) => {
        log('tool:consume_execution_decision', { mode });
        const result = await controller.consumeExecutionDecision({ decisionId, mode });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
);

server.registerTool(
    'implementation_complete',
    {
        description: 'Mark implementation as complete. Transitions to SYNC.',
        inputSchema: z.object({}),
    },
    async () => {
        log('tool:implementation_complete');
        const result = await controller.implementationComplete();
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
);

server.registerTool(
    'sync_complete',
    {
        description: 'Mark sync as complete. Transitions to DONE.',
        inputSchema: z.object({}),
    },
    async () => {
        log('tool:sync_complete');
        const result = await controller.syncComplete();
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
);

server.registerTool(
    'block',
    {
        description: 'Transition to BLOCKED state with an optional reason.',
        inputSchema: z.object({
            reason: z.string().optional().describe('Reason for blocking'),
        }),
    },
    async ({ reason }) => {
        log('tool:block');
        const result = await controller.block({ reason });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
);

server.registerTool(
    'replan',
    {
        description: 'Replan from BLOCKED state back to INTERPRETATION_PENDING.',
        inputSchema: z.object({
            reason: z.string().optional().describe('Reason for replanning'),
        }),
    },
    async ({ reason }) => {
        log('tool:replan');
        const result = await controller.replan({ reason });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
);

server.registerTool(
    'get_state',
    {
        description: 'Get the current controller state (reads persistent store).',
        inputSchema: z.object({}),
    },
    async () => {
        const result = await controller.getState();
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
);

server.registerTool(
    'get_tasks',
    {
        description: 'Get current task states.',
        inputSchema: z.object({}),
    },
    async () => {
        const result = await controller.getTasks();
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
);

server.registerTool(
    'validate_edit',
    {
        description:
            'Validate an edit against current file content. Returns EDITABLE, ALREADY_APPLIED, or CONFLICT. ' +
            'Call BEFORE executing an edit tool. Only valid in EXECUTING_INLINE or EXECUTING_SUBAGENTS states.',
        inputSchema: z.object({
            oldString: z.string().describe('The exact string to find in content (must be unique).'),
            newString: z.string().describe('The replacement string.'),
            content: z.string().describe('The current file content (read fresh with Read tool).'),
            taskId: z.string().optional().describe('Optional task ID for tracking.'),
        }),
    },
    async ({ oldString, newString, content, taskId }) => {
        log('tool:validate_edit', { taskId, oldLen: oldString.length, newLen: newString.length });
        const result = await controller.validateEdit({ oldString, newString, content, taskId });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
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
    async ({ taskId, filePath, fileHash }) => {
        log('tool:complete_task', { taskId, filePath });
        const result = await controller.completeTask({ taskId, filePath, fileHash });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
);

async function main() {
    log('Starting ostacky-controller MCP...');
    log('State path:', { path: statePath });
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log('ostacky-controller connected and ready');
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
