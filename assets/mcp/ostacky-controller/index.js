#!/usr/bin/env node

/**
 * ostacky-controller — persisted state machine for Ostacky orchestration.
 *
 * Usage:
 *   import { OstackyController, buildExecutionSnapshot, STATES, RESULTS } from "./index.js";
 *   const ctl = new OstackyController({ statePath: ".opencode/ostacky-state.json" });
 *
 * State storage:
 *   Persistent JSON file at statePath. Atomic writes via tmpfile+rename.
 *   Default storage is project-local. Safe to commit the schema (not the data).
 *
 * Fallback (controller unavailable):
 *   Ostacky degrades gracefully: reports reduced confidence, preserves
 *   natural-language confirmation gates, defaults to inline execution.
 *   Subagent execution is NEVER authorized without explicit user confirmation,
 *   even in degraded mode.
 *
 * Recovery:
 *   If state file is corrupted or stale, call controller.replan() from BLOCKED,
 *   or delete the state file and start a new request.
 */

/* Exposes structured operations for:
 *   - Starting / resuming a request
 *   - Recording clarification and discovery
 *   - Consuming route decisions (spec / directo)
 *   - Authorizing side-effect actions
 *   - Recording execution snapshots
 *   - Consuming execution-mode decisions
 *   - Validating edits (EDITABLE / ALREADY_APPLIED / CONFLICT)
 *   - Completing tasks
 *
 * Persists state as atomic JSON writes to a configurable path.
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// ─── Constants ──────────────────────────────────────────────────────────────────

export const STATES = Object.freeze({
  INTERPRETATION_PENDING: "INTERPRETATION_PENDING",
  CLARIFICATION_PENDING: "CLARIFICATION_PENDING",
  DISCOVERY: "DISCOVERY",
  LEVEL_RESOLVED: "LEVEL_RESOLVED",
  ROUTE_DECISION_PENDING: "ROUTE_DECISION_PENDING",
  SPECIFICATION: "SPECIFICATION",
  EXECUTION_ANALYSIS: "EXECUTION_ANALYSIS",
  EXECUTION_DECISION_PENDING: "EXECUTION_DECISION_PENDING",
  EXECUTING_INLINE: "EXECUTING_INLINE",
  EXECUTING_SUBAGENTS: "EXECUTING_SUBAGENTS",
  SYNC: "SYNC",
  DONE: "DONE",
  BLOCKED: "BLOCKED",
});

export const RESULTS = Object.freeze({
  OK: "OK",
  INVALID_TRANSITION: "INVALID_TRANSITION",
  DECISION_ALREADY_CONSUMED: "DECISION_ALREADY_CONSUMED",
  ACTION_NOT_AUTHORIZED: "ACTION_NOT_AUTHORIZED",
  EDITABLE: "EDITABLE",
  ALREADY_APPLIED: "ALREADY_APPLIED",
  CONFLICT: "CONFLICT",
  REPLAN_REQUIRED: "REPLAN_REQUIRED",
});

export const ACTIONS = Object.freeze({
  OPENSPEC_PROPOSE: "openspec-propose",
  OPENSPEC_APPLY: "openspec-apply",
  EXECUTION_START: "execution-start",
  EDIT: "edit",
  TASK_COMPLETE: "task-complete",
  SYNC: "sync",
});

// ─── Transition table ────────────────────────────────────────────────────────────

/**
 * Maps current state → allowed transitions.
 * Each entry is an object with a `to` state and optional `via` (the action/operation
 * that triggers the transition).
 */
const TRANSITIONS = {
  [STATES.INTERPRETATION_PENDING]: [
    { to: STATES.CLARIFICATION_PENDING, via: "request_clarification" },
    { to: STATES.DISCOVERY, via: "proceed_to_discovery" },
    { to: STATES.ROUTE_DECISION_PENDING, via: "record_discovery" },
    { to: STATES.BLOCKED, via: "block" },
  ],
  [STATES.CLARIFICATION_PENDING]: [
    { to: STATES.DISCOVERY, via: "record_clarification" },
    { to: STATES.BLOCKED, via: "block" },
    { to: STATES.BLOCKED, via: "abandon" },
  ],
  [STATES.DISCOVERY]: [
    { to: STATES.LEVEL_RESOLVED, via: "record_discovery" },
    { to: STATES.BLOCKED, via: "block" },
    { to: STATES.BLOCKED, via: "abandon" },
  ],
  [STATES.LEVEL_RESOLVED]: [
    { to: STATES.ROUTE_DECISION_PENDING, via: "route_decision_pending" },
    { to: STATES.BLOCKED, via: "block" },
  ],
  [STATES.ROUTE_DECISION_PENDING]: [
    { to: STATES.SPECIFICATION, via: "consume_route_decision", choice: "SPEC" },
    { to: STATES.EXECUTION_ANALYSIS, via: "consume_route_decision", choice: "DIRECT" },
    { to: STATES.BLOCKED, via: "block" },
  ],
  [STATES.SPECIFICATION]: [
    { to: STATES.EXECUTION_ANALYSIS, via: "spec_complete" },
    { to: STATES.BLOCKED, via: "block" },
    { to: STATES.BLOCKED, via: "abandon" },
  ],
  [STATES.EXECUTION_ANALYSIS]: [
    { to: STATES.EXECUTION_DECISION_PENDING, via: "analysis_complete" },
    { to: STATES.BLOCKED, via: "block" },
    { to: STATES.BLOCKED, via: "abandon" },
  ],
  [STATES.EXECUTION_DECISION_PENDING]: [
    { to: STATES.EXECUTING_INLINE, via: "consume_execution_decision", mode: "INLINE" },
    { to: STATES.EXECUTING_SUBAGENTS, via: "consume_execution_decision", mode: "SUBAGENT_DRIVEN" },
    { to: STATES.BLOCKED, via: "block" },
  ],
  [STATES.EXECUTING_INLINE]: [
    { to: STATES.SYNC, via: "implementation_complete" },
    { to: STATES.BLOCKED, via: "block" },
  ],
  [STATES.EXECUTING_SUBAGENTS]: [
    { to: STATES.SYNC, via: "implementation_complete" },
    { to: STATES.BLOCKED, via: "block" },
  ],
  [STATES.BLOCKED]: [
    { to: STATES.INTERPRETATION_PENDING, via: "replan" },
    { to: STATES.DONE, via: "abandon" },
  ],
  [STATES.SYNC]: [
    { to: STATES.DONE, via: "sync_complete" },
    { to: STATES.BLOCKED, via: "block" },
  ],
  [STATES.DONE]: [],
};

// ─── Authorizable actions per state ──────────────────────────────────────────────

/**
 * Which side-effect actions are authorized in each state.
 * An action is an { action, state } pair with optional extra requirements.
 */
const AUTHORIZATIONS = {
  [STATES.SPECIFICATION]: [ACTIONS.OPENSPEC_PROPOSE, ACTIONS.OPENSPEC_APPLY],
  [STATES.EXECUTING_INLINE]: [ACTIONS.EXECUTION_START, ACTIONS.EDIT, ACTIONS.TASK_COMPLETE],
  [STATES.EXECUTING_SUBAGENTS]: [ACTIONS.EXECUTION_START, ACTIONS.EDIT, ACTIONS.TASK_COMPLETE],
  [STATES.SYNC]: [ACTIONS.SYNC],
  [STATES.EDITABLE_VALIDATED]: [ACTIONS.EDIT],
};

// ─── Default state ───────────────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────────

function isAllowedTransition(from, via, choiceOrMode) {
  const transitions = TRANSITIONS[from] || [];
  for (const t of transitions) {
    if (t.via !== via) continue;
    if (t.choice !== undefined && t.choice !== choiceOrMode) continue;
    if (t.mode !== undefined && t.mode !== choiceOrMode) continue;
    return t.to;
  }
  return null;
}

function isActionAuthorized(state, action) {
  const allowed = AUTHORIZATIONS[state];
  return allowed ? allowed.includes(action) : false;
}

/**
 * Validates and normalizes an execution snapshot.
 * Returns the snapshot with defaults filled in, or throws on invalid structure.
 * Pure function — no state access.
 */
export function buildExecutionSnapshot(input = {}) {
  const {
    filesPerTask = {},
    sharedFiles = {},
    fileClusters = [],
    sequentialDeps = [],
    estLines = 0,
    hasExplicitContract = false,
    taskCount = 0,
    clusterCount = 0,
    recommendation = "INLINE",
    reasons = [],
    codegraphUsed = [],
  } = input;

  // Validate recommendation
  if (!["INLINE", "SUBAGENT_DRIVEN"].includes(recommendation)) {
    throw new Error(`Invalid recommendation: ${recommendation}. Must be INLINE or SUBAGENT_DRIVEN`);
  }

  return {
    filesPerTask,
    sharedFiles,
    fileClusters,
    sequentialDeps,
    estLines,
    hasExplicitContract,
    taskCount,
    clusterCount,
    recommendation,
    reasons,
    codegraphUsed,
  };
}

// ─── Controller class ────────────────────────────────────────────────────────────

export class OstackyController {
  #statePath;
  #state;
  #loaded;

  /**
   * @param {Object} opts
   * @param {string} opts.statePath - Path to the persistent state JSON file.
   * @param {Object} [opts.initialState] - Override for initial state (testing).
   */
  constructor(opts = {}) {
    this.#statePath = opts.statePath;
    this.#state = opts.initialState ? { ...DEFAULT_STATE, ...opts.initialState } : null;
    this.#loaded = false;
  }

  // ── Internal persistence ──────────────────────────────────────────────────────

  #load() {
    if (this.#loaded) return;
    if (!this.#statePath) {
      this.#state = { ...DEFAULT_STATE };
      this.#loaded = true;
      return;
    }
    try {
      const raw = readFileSync(this.#statePath, "utf8");
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
    const tmp = this.#statePath + ".tmp." + process.pid;
    writeFileSync(tmp, JSON.stringify(this.#state, null, 2), "utf8");
    renameSync(tmp, this.#statePath);
  }

  #transition(to, changes = {}) {
    this.#state.revision++;
    this.#state.state = to;
    Object.assign(this.#state, changes);
    this.#persist();
  }

  #checkPendingDecisionId(decisionId) {
    if (!this.#state.routeDecisionId && !this.#state.executionDecisionId) {
      // No pending decision, or we check specific cases below
    }
    if (this.#state.routeDecisionId && this.#state.routeDecisionId === decisionId && this.#state.routeChoice) {
      return RESULTS.DECISION_ALREADY_CONSUMED;
    }
    if (this.#state.executionDecisionId && this.#state.executionDecisionId === decisionId && this.#state.executionMode) {
      return RESULTS.DECISION_ALREADY_CONSUMED;
    }
    return null;
  }

  // ── Public API ─────────────────────────────────────────────────────────────────

  /**
   * Start or resume a request.
   * @param {Object} params
   * @param {string} params.requestId
   * @param {string} [params.changeId]
   * @returns {Promise<{status: string, state: string, revision: number, requestId: string}>}
   */
  async startRequest({ requestId, changeId } = {}) {
    this.#load();

    if (this.#state.state !== STATES.INTERPRETATION_PENDING && this.#state.state !== STATES.BLOCKED && this.#state.state !== STATES.DONE) {
      // Already in an active flow — resume path
      return {
        status: RESULTS.OK,
        state: this.#state.state,
        revision: this.#state.revision,
        requestId: this.#state.requestId,
        changeId: this.#state.changeId,
        routeDecisionId: this.#state.routeDecisionId,
        routeChoice: this.#state.routeChoice,
      };
    }

    // Start fresh or replan from BLOCKED
    this.#transition(STATES.INTERPRETATION_PENDING, {
      requestId: requestId || "req-" + Date.now(),
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

    return {
      status: RESULTS.OK,
      state: this.#state.state,
      revision: this.#state.revision,
      requestId: this.#state.requestId,
      changeId: this.#state.changeId,
    };
  }

  /**
   * Record that clarification was requested.
   * @param {Object} params
   * @param {string} [params.question]
   * @returns {Promise<{status: string, state: string, revision: number}>}
   */
  async requestClarification({ question } = {}) {
    this.#load();
    const to = isAllowedTransition(this.#state.state, "request_clarification");
    if (!to) {
      return {
        status: RESULTS.INVALID_TRANSITION,
        state: this.#state.state,
        revision: this.#state.revision,
        reason: `Cannot request clarification from state ${this.#state.state}`,
      };
    }
    this.#transition(to, { error: question ? `Clarification: ${question}` : null });
    return { status: RESULTS.OK, state: this.#state.state, revision: this.#state.revision };
  }

  /**
   * Record that clarification was answered.
   * @returns {Promise<{status: string, state: string, revision: number}>}
   */
  async recordClarification() {
    this.#load();
    const to = isAllowedTransition(this.#state.state, "record_clarification");
    if (!to) {
      return {
        status: RESULTS.INVALID_TRANSITION,
        state: this.#state.state,
        revision: this.#state.revision,
        reason: `Cannot record clarification from state ${this.#state.state}`,
      };
    }
    this.#transition(to, { error: null });
    return { status: RESULTS.OK, state: this.#state.state, revision: this.#state.revision };
  }

  /**
   * Record that discovery is complete and a level was determined.
   * @param {Object} params
   * @param {string} params.level - '0', '0+1', or '1+'
   * @param {string} params.routeDecisionId - Unique ID for the pending route decision
   * @param {Object} [params.snapshot] - Optional CodeGraph snapshot reference
   * @returns {Promise<{status: string, state: string, revision: number, level: string}>}
   */
  async recordDiscovery({ level, routeDecisionId, snapshot } = {}) {
    this.#load();
    const to = isAllowedTransition(this.#state.state, "record_discovery");
    if (!to) {
      return {
        status: RESULTS.INVALID_TRANSITION,
        state: this.#state.state,
        revision: this.#state.revision,
        reason: `Cannot record discovery from state ${this.#state.state}`,
      };
    }

    if (!["0", "0+1", "1+"].includes(level)) {
      return {
        status: RESULTS.INVALID_TRANSITION,
        state: this.#state.state,
        revision: this.#state.revision,
        reason: `Invalid level: ${level}. Must be '0', '0+1', or '1+'`,
      };
    }

    this.#transition(STATES.ROUTE_DECISION_PENDING, {
      routeDecisionId: routeDecisionId || "route-" + Date.now(),
      routeChoice: null,
      snapshots: {
        ...this.#state.snapshots,
        codegraph: snapshot || this.#state.snapshots.codegraph,
      },
    });

    // Default routing: Level 0/0+1 → DIRECT, Level 1+ → SPEC
    const defaultChoice = level === "1+" ? "SPEC" : "DIRECT";

    return {
      status: RESULTS.OK,
      state: this.#state.state,
      revision: this.#state.revision,
      level,
      routeDecisionId: this.#state.routeDecisionId,
      defaultChoice,
    };
  }

  /**
   * Consume the route decision (spec / directo).
   * Only valid in ROUTE_DECISION_PENDING. Consumed exactly once per decisionId.
   * @param {Object} params
   * @param {string} params.decisionId - Must match the pending routeDecisionId
   * @param {string} params.choice - 'SPEC' or 'DIRECT'
   * @returns {Promise<{status: string, state: string, revision: number}>}
   */
  async consumeRouteDecision({ decisionId, choice } = {}) {
    this.#load();

    if (this.#state.state !== STATES.ROUTE_DECISION_PENDING) {
      // Check if already consumed: same decisionId with a routeChoice set
      if (this.#state.routeDecisionId === decisionId && this.#state.routeChoice) {
        return {
          status: RESULTS.DECISION_ALREADY_CONSUMED,
          state: this.#state.state,
          revision: this.#state.revision,
          reason: `Route decision ${decisionId} already consumed as ${this.#state.routeChoice}`,
        };
      }
      return {
        status: RESULTS.INVALID_TRANSITION,
        state: this.#state.state,
        revision: this.#state.revision,
        reason: `Cannot consume route decision from state ${this.#state.state}`,
      };
    }

    if (this.#state.routeDecisionId !== decisionId) {
      return {
        status: RESULTS.INVALID_TRANSITION,
        state: this.#state.state,
        revision: this.#state.revision,
        reason: `Decision ID mismatch: expected ${this.#state.routeDecisionId}, got ${decisionId}`,
      };
    }

    if (choice !== "SPEC" && choice !== "DIRECT") {
      return {
        status: RESULTS.INVALID_TRANSITION,
        state: this.#state.state,
        revision: this.#state.revision,
        reason: `Invalid choice: ${choice}. Must be SPEC or DIRECT`,
      };
    }

    // Check if already consumed
    if (this.#state.routeChoice) {
      return {
        status: RESULTS.DECISION_ALREADY_CONSUMED,
        state: this.#state.state,
        revision: this.#state.revision,
        reason: `Route decision ${decisionId} already consumed as ${this.#state.routeChoice}`,
      };
    }

    const to = isAllowedTransition(this.#state.state, "consume_route_decision", choice);
    if (!to) {
      return {
        status: RESULTS.INVALID_TRANSITION,
        state: this.#state.state,
        revision: this.#state.revision,
        reason: `Route ${choice} not allowed from ${this.#state.state}`,
      };
    }

    this.#transition(to, { routeChoice: choice });
    return {
      status: RESULTS.OK,
      state: this.#state.state,
      revision: this.#state.revision,
      routeChoice: choice,
      allowedActions: isActionAuthorized(this.#state.state, ACTIONS.OPENSPEC_PROPOSE)
        ? [ACTIONS.OPENSPEC_PROPOSE]
        : [],
    };
  }

  /**
   * Record that spec phase is complete (transition from SPECIFICATION → EXECUTION_ANALYSIS).
   * @returns {Promise<{status: string, state: string, revision: number}>}
   */
  async specComplete() {
    this.#load();
    const to = isAllowedTransition(this.#state.state, "spec_complete");
    if (!to) {
      return {
        status: RESULTS.INVALID_TRANSITION,
        state: this.#state.state,
        revision: this.#state.revision,
        reason: `Cannot complete spec from state ${this.#state.state}`,
      };
    }
    this.#transition(to);
    return { status: RESULTS.OK, state: this.#state.state, revision: this.#state.revision };
  }

  /**
   * Record an execution analysis snapshot.
   * @param {Object} params
   * @param {string} params.executionDecisionId - Unique ID for the pending execution mode decision
   * @param {Object} params.snapshot - Execution analysis data
   * @param {string} params.snapshot.recommendation - 'INLINE' or 'SUBAGENT_DRIVEN'
   * @param {Array<string>} params.snapshot.sharedFiles - Shared files between tasks
   * @param {number} params.snapshot.estimatedLines - Estimated total lines changed
   * @param {Array<string>} params.snapshot.reasons - Reasons for the recommendation
   * @returns {Promise<{status: string, state: string, revision: number}>}
   */
  async recordExecutionAnalysis({ executionDecisionId, snapshot } = {}) {
    this.#load();
    const to = isAllowedTransition(this.#state.state, "analysis_complete");
    if (!to) {
      return {
        status: RESULTS.INVALID_TRANSITION,
        state: this.#state.state,
        revision: this.#state.revision,
        reason: `Cannot record execution analysis from state ${this.#state.state}`,
      };
    }

    this.#transition(STATES.EXECUTION_DECISION_PENDING, {
      executionDecisionId: executionDecisionId || "exec-" + Date.now(),
      executionMode: null,
      snapshots: {
        ...this.#state.snapshots,
        execution: snapshot || null,
      },
    });

    return {
      status: RESULTS.OK,
      state: this.#state.state,
      revision: this.#state.revision,
      executionDecisionId: this.#state.executionDecisionId,
    };
  }

  /**
   * Consume the execution mode decision (inline / subagent-driven).
   * @param {Object} params
   * @param {string} params.decisionId
   * @param {string} params.mode - 'INLINE' or 'SUBAGENT_DRIVEN'
   * @returns {Promise<{status: string, state: string, revision: number, allowedActions: string[]}>}
   */
  async consumeExecutionDecision({ decisionId, mode } = {}) {
    this.#load();

    if (this.#state.state !== STATES.EXECUTION_DECISION_PENDING) {
      if (this.#state.executionDecisionId === decisionId && this.#state.executionMode) {
        return {
          status: RESULTS.DECISION_ALREADY_CONSUMED,
          state: this.#state.state,
          revision: this.#state.revision,
          reason: `Execution decision ${decisionId} already consumed as ${this.#state.executionMode}`,
        };
      }
      return {
        status: RESULTS.INVALID_TRANSITION,
        state: this.#state.state,
        revision: this.#state.revision,
        reason: `Cannot consume execution decision from state ${this.#state.state}`,
      };
    }

    if (this.#state.executionDecisionId !== decisionId) {
      return {
        status: RESULTS.INVALID_TRANSITION,
        state: this.#state.state,
        revision: this.#state.revision,
        reason: `Decision ID mismatch: expected ${this.#state.executionDecisionId}, got ${decisionId}`,
      };
    }

    if (mode !== "INLINE" && mode !== "SUBAGENT_DRIVEN") {
      return {
        status: RESULTS.INVALID_TRANSITION,
        state: this.#state.state,
        revision: this.#state.revision,
        reason: `Invalid mode: ${mode}. Must be INLINE or SUBAGENT_DRIVEN`,
      };
    }

    if (this.#state.executionMode) {
      return {
        status: RESULTS.DECISION_ALREADY_CONSUMED,
        state: this.#state.state,
        revision: this.#state.revision,
        reason: `Execution decision ${decisionId} already consumed as ${this.#state.executionMode}`,
      };
    }

    const to = isAllowedTransition(this.#state.state, "consume_execution_decision", mode);
    if (!to) {
      return {
        status: RESULTS.INVALID_TRANSITION,
        state: this.#state.state,
        revision: this.#state.revision,
        reason: `Mode ${mode} not allowed from ${this.#state.state}`,
      };
    }

    this.#transition(to, { executionMode: mode });

    return {
      status: RESULTS.OK,
      state: this.#state.state,
      revision: this.#state.revision,
      executionMode: mode,
      allowedActions: isActionAuthorized(this.#state.state, ACTIONS.EXECUTION_START)
        ? [ACTIONS.EXECUTION_START, ACTIONS.EDIT, ACTIONS.TASK_COMPLETE]
        : [],
    };
  }

  /**
   * Authorize a side-effect action based on current state.
   * @param {string} action - One of ACTIONS values
   * @param {Object} [context] - Optional context (e.g. { editResult } for edit action)
   * @returns {Promise<{status: string, state: string, revision: number, allowed: boolean}>}
   */
  async authorize(action, context = {}) {
    this.#load();

    // Special case: edit requires an EDITABLE validation result
    if (action === ACTIONS.EDIT) {
      if (context.editResult !== RESULTS.EDITABLE) {
        return {
          status: RESULTS.ACTION_NOT_AUTHORIZED,
          state: this.#state.state,
          revision: this.#state.revision,
          reason: `Edit requires EDITABLE result, got ${context.editResult || "none"}`,
          allowed: false,
        };
      }
    }

    if (!isActionAuthorized(this.#state.state, action)) {
      return {
        status: RESULTS.INVALID_TRANSITION,
        state: this.#state.state,
        revision: this.#state.revision,
        reason: `Action ${action} not authorized from state ${this.#state.state}`,
        allowed: false,
      };
    }

    return {
      status: RESULTS.OK,
      state: this.#state.state,
      revision: this.#state.revision,
      allowed: true,
    };
  }

  /**
   * Validate an edit operation before applying it.
   * Pure function — does not depend on persisted state.
   *
   * @param {Object} params
   * @param {string} params.oldString
   * @param {string} params.newString
   * @param {string} params.content - Fresh file content
   * @returns {{status: string, reason?: string}}
   */
  validateEdit({ oldString, newString, content } = {}) {
    // Same content → already applied
    if (oldString === newString) {
      return { status: RESULTS.ALREADY_APPLIED, reason: "oldString equals newString" };
    }

    const oldPresent = content.includes(oldString);
    const newPresent = content.includes(newString);

    if (oldPresent) {
      return { status: RESULTS.EDITABLE };
    }

    // old not present
    if (newPresent) {
      return { status: RESULTS.ALREADY_APPLIED, reason: "newString already present in content" };
    }

    // Neither old nor new present
    return { status: RESULTS.CONFLICT, reason: "oldString not found and newString not present" };
  }

  /**
   * Mark a task as completed.
   * @param {Object} params
   * @param {string} params.taskId
   * @param {string} [params.note] - Optional note
   * @returns {Promise<{status: string, state: string, revision: number, taskState: Object}>}
   */
  async completeTask({ taskId, note } = {}) {
    this.#load();

    const executingStates = [STATES.EXECUTING_INLINE, STATES.EXECUTING_SUBAGENTS];
    if (!executingStates.includes(this.#state.state)) {
      return {
        status: RESULTS.INVALID_TRANSITION,
        state: this.#state.state,
        revision: this.#state.revision,
        reason: `Cannot complete task from state ${this.#state.state}`,
      };
    }

    const taskState = {
      completedAt: new Date().toISOString(),
      note: note || null,
      revision: this.#state.revision,
    };

    this.#state.tasks[taskId] = taskState;
    this.#persist();

    return {
      status: RESULTS.OK,
      state: this.#state.state,
      revision: this.#state.revision,
      taskState,
    };
  }

  /**
   * Transition to BLOCKED state.
   * @param {Object} params
   * @param {string} [params.reason]
   * @returns {Promise<{status: string, state: string, revision: number}>}
   */
  async block({ reason } = {}) {
    this.#load();
    const to = isAllowedTransition(this.#state.state, "block");
    if (!to) {
      return {
        status: RESULTS.INVALID_TRANSITION,
        state: this.#state.state,
        revision: this.#state.revision,
        reason: `Cannot block from state ${this.#state.state}`,
      };
    }
    this.#transition(to, { error: reason || "Blocked" });
    return { status: RESULTS.OK, state: this.#state.state, revision: this.#state.revision };
  }

  /**
   * Replan: transition from BLOCKED back to INTERPRETATION_PENDING.
   * @param {Object} params
   * @param {string} [params.reason]
   * @returns {Promise<{status: string, state: string, revision: number}>}
   */
  async replan({ reason } = {}) {
    this.#load();
    const to = isAllowedTransition(this.#state.state, "replan");
    if (!to) {
      return {
        status: RESULTS.INVALID_TRANSITION,
        state: this.#state.state,
        revision: this.#state.revision,
        reason: `Cannot replan from state ${this.#state.state}`,
      };
    }
    this.#transition(to, {
      error: reason || null,
      // Preserve requestId and changeId, but reset workflow state
      routeDecisionId: null,
      routeChoice: null,
      executionDecisionId: null,
      executionMode: null,
      snapshots: { codegraph: null, execution: null },
      tasks: {},
      fileFingerprints: {},
    });
    return { status: RESULTS.OK, state: this.#state.state, revision: this.#state.revision };
  }

  /**
   * Transition to SYNC state (implementation complete).
   * @returns {Promise<{status: string, state: string, revision: number}>}
   */
  async implementationComplete() {
    this.#load();
    const to = isAllowedTransition(this.#state.state, "implementation_complete");
    if (!to) {
      return {
        status: RESULTS.INVALID_TRANSITION,
        state: this.#state.state,
        revision: this.#state.revision,
        reason: `Cannot complete implementation from state ${this.#state.state}`,
      };
    }
    this.#transition(to);
    return { status: RESULTS.OK, state: this.#state.state, revision: this.#state.revision };
  }

  /**
   * Transition to DONE (sync complete).
   * @returns {Promise<{status: string, state: string, revision: number}>}
   */
  async syncComplete() {
    this.#load();
    const to = isAllowedTransition(this.#state.state, "sync_complete");
    if (!to) {
      return {
        status: RESULTS.INVALID_TRANSITION,
        state: this.#state.state,
        revision: this.#state.revision,
        reason: `Cannot complete sync from state ${this.#state.state}`,
      };
    }
    this.#transition(to);
    return { status: RESULTS.OK, state: this.#state.state, revision: this.#state.revision };
  }

  /**
   * Get current state (reads from persistent store).
   * @returns {Promise<Object>}
   */
  async getState() {
    this.#load();
    return { ...this.#state };
  }

  /**
   * Get current task states.
   * @returns {Promise<Object>}
   */
  async getTasks() {
    this.#load();
    return { ...this.#state.tasks };
  }

  /**
   * Record a CodeGraph snapshot for reuse across phases.
   * @param {Object} snapshot - The CodeGraph context/impact/trace data
   * @returns {Promise<{status: string, revision: number}>}
   */
  async recordCodegraphSnapshot(snapshot) {
    this.#load();
    this.#state.snapshots = {
      ...this.#state.snapshots,
      codegraph: {
        data: snapshot,
        capturedAt: new Date().toISOString(),
        revision: this.#state.revision,
      },
    };
    // Track used CodeGraph calls for instrumentation
    if (snapshot?.calls) {
      this.#state.lastCodegraphCalls = snapshot.calls;
    }
    this.#persist();
    return { status: RESULTS.OK, revision: this.#state.revision };
  }

  /**
   * Get the stored CodeGraph snapshot, or null if none.
   * @returns {Promise<Object|null>}
   */
  async getCodegraphSnapshot() {
    this.#load();
    return this.#state.snapshots?.codegraph || null;
  }

  /**
   * Record file fingerprints (mtime + size) for staleness detection.
   * @param {Object<string, {mtime: number, size: number}>} fingerprints - File path → fingerprint
   * @returns {Promise<{status: string, revision: number}>}
   */
  async recordFileFingerprints(fingerprints) {
    this.#load();
    Object.assign(this.#state.fileFingerprints, fingerprints);
    this.#persist();
    return { status: RESULTS.OK, revision: this.#state.revision };
  }

  /**
   * Validate a snapshot revision AND file fingerprints for staleness.
   * Returns REPLAN_REQUIRED if revision doesn't match or fingerprints changed.
   * @param {number} snapshotRevision
   * @param {Object<string, {mtime: number, size: number}>} [currentFingerprints]
   * @returns {Promise<{valid: boolean, status?: string, currentRevision: number, staleFingerprints?: string[]}>}
   */
  async validateSnapshot(snapshotRevision, currentFingerprints) {
    this.#load();
    const result = {
      valid: true,
      currentRevision: this.#state.revision,
    };

    if (snapshotRevision !== this.#state.revision) {
      result.valid = false;
      result.status = RESULTS.REPLAN_REQUIRED;
      return result;
    }

    if (currentFingerprints && this.#state.fileFingerprints) {
      const stale = [];
      for (const [file, fp] of Object.entries(currentFingerprints)) {
        const stored = this.#state.fileFingerprints[file];
        if (stored && (stored.mtime !== fp.mtime || stored.size !== fp.size)) {
          stale.push(file);
        }
      }
      if (stale.length > 0) {
        result.valid = false;
        result.status = RESULTS.REPLAN_REQUIRED;
        result.staleFingerprints = stale;
      }
    }

    if (!result.valid) {
      result.status = result.status || RESULTS.REPLAN_REQUIRED;
    }

    return result;
  }

  /**
   * Record a stable key for Engram boundary persistence.
   * @param {Object} params
   * @param {string} params.changeKey - e.g. "change/redesign-ostacky-orchestration"
   * @param {string} [params.taskKey] - e.g. "task/controller-core"
   * @returns {Promise<{status: string}>}
   */
  async recordEngramKey({ changeKey, taskKey } = {}) {
    this.#load();
    if (changeKey) this.#state.changeKey = changeKey;
    if (taskKey) this.#state.taskKey = taskKey;
    this.#persist();
    return { status: RESULTS.OK };
  }

  /**
   * Get stored Engram keys.
   * @returns {Promise<{changeKey?: string, taskKey?: string}>}
   */
  async getEngramKeys() {
    this.#load();
    return {
      changeKey: this.#state.changeKey,
      taskKey: this.#state.taskKey,
    };
  }

  /**
   * Increment an instrumentation counter.
   * @param {string} name - Counter name (e.g. "codegraph_calls", "engram_calls", "subagent_dispatches")
   * @param {number} [by=1] - Increment amount
   * @returns {Promise<number>} - New counter value
   */
  async incrementCounter(name, by = 1) {
    this.#load();
    if (!this.#state.counters) this.#state.counters = {};
    this.#state.counters[name] = (this.#state.counters[name] || 0) + by;
    this.#persist();
    return this.#state.counters[name];
  }

  /**
   * Get all instrumentation counters.
   * @returns {Promise<Object<string, number>>}
   */
  async getCounters() {
    this.#load();
    return { ...(this.#state.counters || {}) };
  }

  /**
   * Reset all instrumentation counters.
   * @returns {Promise<{status: string}>}
   */
  async resetCounters() {
    this.#load();
    this.#state.counters = {};
    this.#persist();
    return { status: RESULTS.OK };
  }
}
