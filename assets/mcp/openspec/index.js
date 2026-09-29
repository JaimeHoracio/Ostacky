#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import {
    readFileSync,
    writeFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
    renameSync,
    unlinkSync,
} from 'node:fs';
import { join, dirname, basename } from 'node:path';

const PROJECT_ROOT = process.cwd();
const OPENSPEC_DIR = join(PROJECT_ROOT, 'openspec');

function safeJsonStringify(obj, indent = 2) {
    const seen = new WeakSet();
    return JSON.stringify(obj, (key, value) => {
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) return '[Circular]';
            seen.add(value);
        }
        if (typeof value === 'bigint') return value.toString();
        if (value instanceof Error) return { message: value.message, stack: value.stack, name: value.name };
        return value;
    }, indent);
}

function log(event, data) {
    const ts = new Date().toISOString();
    const payload = data ? ` ${safeJsonStringify(data)}` : '';
    console.error(`[${ts}] ${event}${payload}`);
}

/**
 * Cleans up stale .tmp.* files from a previous crash.
 */
function cleanupTmpFiles(dir) {
    if (!dir || !existsSync(dir)) return;
    try {
        for (const entry of readdirSync(dir)) {
            if (entry.includes('.tmp.')) {
                try {
                    unlinkSync(join(dir, entry));
                } catch {
                    /* best-effort */
                }
            }
        }
    } catch {
        /* best-effort */
    }
}

/**
 * Atomic write: write to tmp file, then rename.
 * Prevents corruption on crash.
 */
function atomicWriteSync(filePath, content) {
    const dir = dirname(filePath);
    mkdirSync(dir, { recursive: true });
    const tmp = filePath + '.tmp.' + process.pid;
    writeFileSync(tmp, content, 'utf-8');
    renameSync(tmp, filePath);
}

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

// ── Input Validation ─────────────────────────────────────────────────────────

function validateChangeId(changeId) {
    if (!changeId || typeof changeId !== 'string') {
        return 'changeId is required and must be a non-empty string';
    }
    if (/[\/\\]/.test(changeId) || changeId === '.' || changeId === '..') {
        return 'changeId contains invalid characters';
    }
    return null;
}

function validateProposalInput({ title, description, scope }) {
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return 'title is required and must be a non-empty string';
    }
    if (!description || typeof description !== 'string' || description.trim().length === 0) {
        return 'description is required and must be a non-empty string';
    }
    if (!scope || typeof scope !== 'string' || scope.trim().length === 0) {
        return 'scope is required and must be a non-empty string';
    }
    return null;
}

// ── OpenSpec State Manager ──────────────────────────────────────────────────

class OpenSpecManager {
    #changesDir;

    constructor() {
        this.#changesDir = join(OPENSPEC_DIR, 'changes');
        if (!existsSync(this.#changesDir)) {
            mkdirSync(this.#changesDir, { recursive: true });
        }
        // Clean up stale tmp files from previous crashes
        cleanupTmpFiles(this.#changesDir);
    }

    listChanges() {
        if (!existsSync(this.#changesDir)) return [];
        return readdirSync(this.#changesDir).filter(f =>
            existsSync(join(this.#changesDir, f, 'proposal.md'))
        );
    }

    getChange(changeId) {
        const changeDir = join(this.#changesDir, changeId);
        if (!existsSync(changeDir)) return null;

        const proposal = existsSync(join(changeDir, 'proposal.md'))
            ? readFileSync(join(changeDir, 'proposal.md'), 'utf-8')
            : null;
        const design = existsSync(join(changeDir, 'design.md'))
            ? readFileSync(join(changeDir, 'design.md'), 'utf-8')
            : null;
        const tasks = existsSync(join(changeDir, 'tasks.md'))
            ? readFileSync(join(changeDir, 'tasks.md'), 'utf-8')
            : null;

        return { changeId, proposal, design, tasks };
    }

    createProposal({ title, description, scope }) {
        const changeId = `change-${Date.now()}`;
        const changeDir = join(this.#changesDir, changeId);
        mkdirSync(changeDir, { recursive: true });

        const proposal = `# ${title}

## Description
${description}

## Scope
${scope}

## Status
- Created: ${new Date().toISOString()}
- Phase: proposal
`;

        atomicWriteSync(join(changeDir, 'proposal.md'), proposal);
        log('proposal:created', { changeId, title });
        return { changeId, status: 'created' };
    }

    archiveChange({ changeId }) {
        const changeDir = join(this.#changesDir, changeId);
        if (!existsSync(changeDir)) {
            return { error: `Change ${changeId} not found` };
        }

        // Move to archive
        const archiveDir = join(OPENSPEC_DIR, 'archive');
        if (!existsSync(archiveDir)) {
            mkdirSync(archiveDir, { recursive: true });
        }

        renameSync(changeDir, join(archiveDir, changeId));
        log('change:archived', { changeId });
        return { changeId, status: 'archived' };
    }
}

const manager = new OpenSpecManager();

// ── MCP Server ──────────────────────────────────────────────────────────────

const server = new McpServer({
    name: 'openspec',
    version: '0.6.1',
});

server.registerTool(
    'openspec_list',
    {
        description: 'List all active changes',
        inputSchema: z.object({}),
    },
    safeHandler(async () => {
        log('tool:openspec_list');
        const changes = manager.listChanges();
        return { changes };
    })
);

server.registerTool(
    'openspec_propose',
    {
        description: 'Create a new change proposal',
        inputSchema: z.object({
            title: z.string().min(1).describe('Change title'),
            description: z.string().min(1).describe('Change description'),
            scope: z.string().min(1).describe('Change scope'),
        }),
    },
    safeHandler(async ({ title, description, scope }) => {
        log('tool:openspec_propose', { title });
        return manager.createProposal({ title, description, scope });
    })
);

server.registerTool(
    'openspec_archive',
    {
        description: 'Archive a completed change',
        inputSchema: z.object({
            changeId: z.string().min(1).describe('Change ID to archive'),
        }),
    },
    safeHandler(async ({ changeId }) => {
        const validationError = validateChangeId(changeId);
        if (validationError) return { error: validationError };
        log('tool:openspec_archive', { changeId });
        return manager.archiveChange({ changeId });
    })
);

server.registerTool(
    'openspec_get_change',
    {
        description: 'Get change details (proposal, design, tasks)',
        inputSchema: z.object({
            changeId: z.string().min(1).describe('Change ID'),
        }),
    },
    safeHandler(async ({ changeId }) => {
        const validationError = validateChangeId(changeId);
        if (validationError) return { error: validationError };
        log('tool:openspec_get_change', { changeId });
        return manager.getChange(changeId);
    })
);

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
    log('Starting openspec MCP...');
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log('openspec MCP connected and ready');
}

async function shutdown(signal) {
    log('mcp:shutdown', { signal });
    try {
        await server.close();
    } catch (err) {
        log('mcp:shutdown:error', { error: err.message });
    }
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
    log('mcp:uncaughtException', { error: error.message, stack: error.stack });
    shutdown('uncaughtException');
});

const isDirectRun =
    process.argv[1] && (process.argv[1].endsWith('/index.js') || process.argv[1].endsWith('\\index.js'));

if (isDirectRun) {
    main().catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

export { OpenSpecManager };
