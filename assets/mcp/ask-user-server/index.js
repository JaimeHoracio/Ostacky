#!/usr/bin/env node

/**
 * ask-user-server — MCP server that provides the ask_user tool.
 *
 * The tool blocks execution until the user responds via the terminal.
 * Reads from /dev/tty (not process.stdin) to avoid conflicting with
 * the MCP JSON-RPC protocol on stdin/stdout.
 *
 * Protocol: MCP (Model Context Protocol) via stdio transport.
 * Messages are JSON-RPC 2.0, one JSON object per line, terminated by \n.
 *
 * Usage:
 *   This server is configured as a local MCP server in opencode.jsonc:
 *   "ask-user": {
 *     "type": "local",
 *     "command": ["node", ".opencode/mcp/ask-user-server/index.js"],
 *     "enabled": true
 *   }
 */

import { createInterface } from 'readline';
import { createReadStream, writeFileSync } from 'fs';
import { open } from 'fs/promises';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Writes a JSON-RPC message to stdout (MCP response). */
function send(id, result, isError = false) {
    const msg = {
        jsonrpc: '2.0',
        ...(id !== undefined ? { id } : {}),
    };
    if (isError) {
        msg.error = result;
    } else {
        msg.result = result;
    }
    process.stdout.write(JSON.stringify(msg) + '\n');
}

/** Sends a JSON-RPC notification (no id). */
function notify(method, params) {
    const msg = { jsonrpc: '2.0', method, params };
    process.stdout.write(JSON.stringify(msg) + '\n');
}

/** Logs to stderr (visible to user, not part of MCP protocol). */
function log(msg) {
    process.stderr.write(msg + '\n');
}

/** Reads a line of user input from /dev/tty (with fallback to process.stdin). */
async function readLineFromTTY(prompt) {
    // Try /dev/tty first
    if (process.platform !== 'win32') {
        try {
            const tty = createReadStream('/dev/tty');
            return await new Promise((resolve, reject) => {
                // If /dev/tty fails asynchronously, fall back immediately
                tty.on('error', () => {
                    tty.destroy();
                    resolve(null); // signal fallback
                });
                tty.on('open', () => {
                    const rl = createInterface({ input: tty, output: process.stderr });
                    rl.question(prompt || '> ', (answer) => {
                        rl.close();
                        tty.destroy();
                        resolve(answer);
                    });
                });
            });
        } catch {
            // Synchronous error (unlikely) → fallback
        }
    }

    // Fallback: if /dev/tty failed or Windows
    log(
        '[ask-user] /dev/tty not available, reading from stdin. ' +
            "If the prompt doesn't appear, check terminal settings."
    );
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    return await new Promise((resolve) => {
        rl.question(prompt || '> ', (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

// ─── Tool handler ─────────────────────────────────────────────────────────────

async function handleAskUser(args) {
    const { question, options, context } = args || {};

    if (!question) {
        throw new Error("ask_user requires a 'question' field (string).");
    }

    // Display to user via stderr
    log('');
    if (context) {
        log(context);
    }
    log(`❓ ${question}`);
    if (options && Array.isArray(options) && options.length > 0) {
        log(`Opciones: ${options.join(', ')}`);
    }

    const answer = await readLineFromTTY('> ');

    if (options && options.length > 0 && !options.includes(answer)) {
        log(`⚠️  Respuesta no está entre las opciones: ${options.join(', ')}`);
        log(`Se usará igual: "${answer}"`);
    }

    return { content: [{ type: 'text', text: JSON.stringify({ answer }) }] };
}

// ─── Server capabilities ──────────────────────────────────────────────────────

const CAPABILITIES = {
    tools: {
        ask_user: {
            description:
                'Ask the user a question and block execution until they respond. ' +
                'Use this whenever you need a decision, confirmation, or input from the user.',
            inputSchema: {
                type: 'object',
                properties: {
                    question: {
                        type: 'string',
                        description: 'The question to ask the user.',
                    },
                    options: {
                        type: 'array',
                        items: { type: 'string' },
                        description:
                            'Predefined answer options (optional). If provided, they are displayed to the user.',
                    },
                    context: {
                        type: 'string',
                        description: 'Additional context to display before the question (optional).',
                    },
                },
                required: ['question'],
            },
        },
    },
};

// ─── JSON-RPC dispatcher ──────────────────────────────────────────────────────

async function handleRequest(msg) {
    const { id, method, params } = msg;

    try {
        switch (method) {
            // ── Lifecycle ───────────────────────────────────────────────
            case 'initialize': {
                send(id, {
                    protocolVersion: '2024-11-05',
                    capabilities: {
                        tools: {}, // we support tools
                    },
                    serverInfo: {
                        name: 'ask-user-server',
                        version: '0.5.1',
                    },
                });
                break;
            }

            case 'notifications/initialized': {
                // No response needed for notifications
                break;
            }

            // ── Tools ───────────────────────────────────────────────────
            case 'tools/list': {
                send(id, {
                    tools: Object.entries(CAPABILITIES.tools).map(([name, def]) => ({
                        name,
                        description: def.description,
                        inputSchema: def.inputSchema,
                    })),
                });
                break;
            }

            case 'tools/call': {
                const { name, arguments: args } = params || {};
                const toolDef = CAPABILITIES.tools[name];

                if (!toolDef) {
                    send(
                        id,
                        {
                            code: -32601,
                            message: `Tool not found: ${name}`,
                        },
                        true
                    );
                    break;
                }

                const result = await handleAskUser(args);
                send(id, result);
                break;
            }

            // ── Ping / unknown ──────────────────────────────────────────
            case 'ping': {
                send(id, {});
                break;
            }

            default: {
                send(
                    id,
                    {
                        code: -32601,
                        message: `Method not found: ${method}`,
                    },
                    true
                );
                break;
            }
        }
    } catch (err) {
        send(
            id,
            {
                code: -32603,
                message: err.message || 'Internal error',
            },
            true
        );
    }
}

// ─── Main loop ────────────────────────────────────────────────────────────────

let buffer = '';

process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // keep incomplete line in buffer

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            const msg = JSON.parse(trimmed);
            handleRequest(msg);
        } catch (err) {
            log(`[ask-user] Invalid JSON-RPC: ${err.message}`);
        }
    }
});

process.stdin.on('end', () => {
    process.exit(0);
});

// Log startup
log('[ask-user-server] Started. Waiting for MCP messages...');
