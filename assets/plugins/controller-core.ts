/**
 * controller-core — Single source of truth para TRANSITIONS, STATES, DEFAULT_STATE y helpers.
 * Extraído de assets/mcp/ostacky-controller/index.js y assets/plugins/ostacky-plugin.ts
 * para eliminar duplicación (D1). Ambos importan de acá.
 */

import { SENSITIVE_DEFAULT } from "./security.js";

// --- Constants (headroom generoso) ---
export const MAX_TASKS = 100;
export const MAX_TASKS_DEFAULT = 100;
export const MAX_TASKS_CAP = 500;
export const MAX_SNAPSHOT_JSON_LENGTH = 50 * 1024;
export const MAX_STATE_FILE_SIZE = 2 * 1024 * 1024;
export const DEGRADED_THRESHOLD = 3;

export const STATES = Object.freeze({
  INTERPRETATION_PENDING: "INTERPRETATION_PENDING",
  CLARIFICATION_PENDING: "CLARIFICATION_PENDING",
  DISCOVERY: "DISCOVERY",
  ROUTE_DECISION_PENDING: "ROUTE_DECISION_PENDING",
  SPECIFICATION: "SPECIFICATION",
  EXECUTION_ANALYSIS: "EXECUTION_ANALYSIS",
  EXECUTION_DECISION_PENDING: "EXECUTION_DECISION_PENDING",
  EXECUTING_INLINE: "EXECUTING_INLINE",
  EXECUTING_SUBAGENTS: "EXECUTING_SUBAGENTS",
  SYNC: "SYNC",
  DONE: "DONE",
  BLOCKED: "BLOCKED",
} as const);

export const TRANSITIONS: Record<string, Array<{ via: string; to: string; choice?: string; mode?: string }>> = {
  INTERPRETATION_PENDING: [
    { via: "request_clarification", to: "CLARIFICATION_PENDING" },
    { via: "proceed_to_discovery", to: "DISCOVERY" },
    { via: "record_discovery", to: "ROUTE_DECISION_PENDING" },
    { via: "block", to: "BLOCKED" },
  ],
  CLARIFICATION_PENDING: [
    { via: "record_clarification", to: "DISCOVERY" },
    { via: "block", to: "BLOCKED" },
    { via: "abandon", to: "BLOCKED" },
  ],
  DISCOVERY: [
    { via: "record_discovery", to: "ROUTE_DECISION_PENDING" },
    { via: "block", to: "BLOCKED" },
    { via: "abandon", to: "BLOCKED" },
  ],
  ROUTE_DECISION_PENDING: [
    { via: "consume_route_decision", to: "SPECIFICATION", choice: "SPEC" },
    { via: "consume_route_decision", to: "EXECUTION_ANALYSIS", choice: "DIRECT" },
    { via: "block", to: "BLOCKED" },
    { via: "abandon", to: "BLOCKED" },
  ],
  SPECIFICATION: [
    { via: "spec_complete", to: "EXECUTION_ANALYSIS" },
    { via: "block", to: "BLOCKED" },
    { via: "abandon", to: "BLOCKED" },
  ],
  EXECUTION_ANALYSIS: [
    { via: "record_execution_analysis", to: "EXECUTION_DECISION_PENDING" },
    { via: "block", to: "BLOCKED" },
    { via: "abandon", to: "BLOCKED" },
  ],
  EXECUTION_DECISION_PENDING: [
    { via: "consume_execution_decision", to: "EXECUTING_INLINE", mode: "INLINE" },
    { via: "consume_execution_decision", to: "EXECUTING_SUBAGENTS", mode: "SUBAGENT_DRIVEN" },
    { via: "block", to: "BLOCKED" },
    { via: "abandon", to: "BLOCKED" },
  ],
  EXECUTING_INLINE: [
    { via: "implementation_complete", to: "SYNC" },
    { via: "block", to: "BLOCKED" },
  ],
  EXECUTING_SUBAGENTS: [
    { via: "implementation_complete", to: "SYNC" },
    { via: "block", to: "BLOCKED" },
  ],
  BLOCKED: [
    { via: "replan", to: "INTERPRETATION_PENDING" },
    { via: "abandon", to: "DONE" },
  ],
  SYNC: [
    { via: "sync_complete", to: "DONE" },
    { via: "block", to: "BLOCKED" },
  ],
  DONE: [],
};

export const TERMINAL_STATES = Object.freeze([
  STATES.INTERPRETATION_PENDING,
  STATES.CLARIFICATION_PENDING,
  STATES.BLOCKED,
  STATES.DONE,
]);

export const DEFAULT_STATE: any = {
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
  lastHandoff: null,
  expectedTasks: null,
  expectedTaskCount: null,
  auditSeq: 0,
  degraded: false,
  schemaVersion: 2,
  stateOversizedCount: 0,
  codegraphBypassCount: 0,
  degradedEditsCount: 0,
  cacheHitCount: 0,
  cacheMissCount: 0,
  tokenSavingEstimate: 0,
  discoveryCacheHitCount: 0,
  redundantCallCount: 0,
  cacheMissWithoutPutCount: 0,
  stateCheckCount: 0,
  toolCallCount: 0,
  lastProposal: null,
  allowedFiles: {},
  deniedFiles: {},
  sensitivePatterns: [...SENSITIVE_DEFAULT],
  sensitiveAccess: { allowed: 0, denied: 0, blockedAttempts: 0 },
  staleContentAttempts: 0,
  completeWithoutValidateCount: 0,
  toolTimeoutCount: 0,
  lastToolDurationMs: 0,
  stateDurationMs: 0,
  subagentFailedCount: 0,
  lastValidated: null,
  pendingFileAccess: {},
  lastHeartbeat: 0,
  watchdogEnabled: true,
  ts: Date.now(),
  specNotInSync: false,
};

export function safeJsonStringify(obj: any, pretty = false): string {
  const seen = new WeakSet();
  try {
    return JSON.stringify(
      obj,
      (key, value) => {
        if (typeof value === "object" && value !== null) {
          if (seen.has(value)) return "[Circular]";
          seen.add(value);
        }
        return value;
      },
      pretty ? 2 : undefined
    );
  } catch (e: any) {
    return `[Unstringifiable: ${e.message}]`;
  }
}

const SENSITIVE_REDACT_RE = /(apiKey|secret|token|password|api_key)/i;

export function redactForLog(data: any): any {
  if (!data || typeof data !== "object") return data;
  try {
    const str = safeJsonStringify(data);
    if (SENSITIVE_REDACT_RE.test(str)) {
      const copy = JSON.parse(str);
      const redactRecursively = (obj: any) => {
        if (!obj || typeof obj !== "object") return;
        for (const k of Object.keys(obj)) {
          if (SENSITIVE_REDACT_RE.test(k)) obj[k] = "[REDACTED]";
          else if (typeof obj[k] === "object") redactRecursively(obj[k]);
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

export function getMaxTasks(): number {
  const raw = process.env.OSTACKY_MAX_TASKS;
  if (raw == null || raw === "") return MAX_TASKS_DEFAULT;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) return MAX_TASKS_DEFAULT;
  if (n > MAX_TASKS_CAP) return MAX_TASKS_CAP;
  return n;
}

export function getAuditRetention(): number {
  const raw = process.env.OSTACKY_AUDIT_RETENTION;
  if (raw == null || raw === "") return 500;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) return 500;
  if (n > 2000) return 2000;
  return n;
}
