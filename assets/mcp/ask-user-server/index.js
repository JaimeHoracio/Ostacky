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

import { openSync, readSync, writeSync, closeSync, readFileSync, readlinkSync } from 'fs';

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

/**
 * Finds the controlling PTY by walking up the parent process chain.
 * MCP child processes do NOT inherit /dev/tty (ENXIO), so we find
 * the terminal device that OpenCode (the parent) is connected to
 * and open it directly.
 */
function findParentTTY() {
    // Try own tty_nr from /proc/self/stat first
    try {
        const stat = readFileSync('/proc/self/stat', 'utf-8');
        const parts = stat.split(' ');
        const ttyNr = parseInt(parts[6], 10); // tty_nr field (7th field, 0-indexed 6)
        if (ttyNr !== 0) {
            const major = (ttyNr >> 8) & 0xfff;
            const minor = (ttyNr & 0xff) | ((ttyNr >> 12) & 0xfff00);
            if (major === 136) return `/dev/pts/${minor}`; // /dev/pts/N
            if (major === 4) return `/dev/tty${minor}`; // /dev/ttyN
            if (major === 3) return `/dev/tty`; // controlling tty
        }
    } catch {
        /* fall through */
    }

    // Walk up parent chain looking for a process with a readable PTY on fd/0
    let pid = process.ppid;
    for (let i = 0; i < 10; i++) {
        try {
            const fd0 = readlinkSync(`/proc/${pid}/fd/0`);
            if (fd0.startsWith('/dev/pts/') || fd0.startsWith('/dev/tty')) {
                // Verify it's actually openable for r/w
                try {
                    const testFd = openSync(fd0, 'r+');
                    closeSync(testFd);
                    return fd0;
                } catch {
                    /* try next */
                }
            }
        } catch {
            /* try next */
        }

        // Move to parent's parent
        try {
            const stat = readFileSync(`/proc/${pid}/stat`, 'utf-8');
            pid = parseInt(stat.split(' ')[3], 10); // ppid field
            if (pid <= 1) break;
        } catch {
            break;
        }
    }

    return null;
}

/** Reads a line of user input from the parent's PTY (synchronous, raw-mode safe). */
async function readLineFromTTY(prompt) {
    if (process.platform !== 'win32') {
        try {
            return readLineFromTTYSync(prompt || '> ');
        } catch (err) {
            log(`[ask-user] PTY read failed: ${err.message}`);
        }
    }

    // Fallback: read from stdin (Windows / no TTY available)
    log(
        '[ask-user] No terminal available, reading from stdin. ' +
            "If the prompt doesn't appear, check terminal settings."
    );
    const { createInterface } = await import('readline');
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    return await new Promise((resolve) => {
        rl.question(prompt || '> ', (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

/**
 * Synchronous line read from the parent process PTY.
 * Handles raw mode (no line buffering, no echo, no cooked processing)
 * by reading byte-by-byte with manual echo and editing support.
 */
function readLineFromTTYSync(prompt) {
    const ttyPath = findParentTTY();
    if (!ttyPath) throw new Error('No TTY found for parent process');
    const fd = openSync(ttyPath, 'r+');
    try {
        // Write prompt
        writeSync(fd, Buffer.from(prompt, 'utf-8'), 0, Buffer.byteLength(prompt, 'utf-8'), null);

        const buf = Buffer.alloc(1);
        let line = '';
        while (true) {
            const bytesRead = readSync(fd, buf, 0, 1, null);
            if (bytesRead === 0) break; // EOF (Ctrl+D)
            const byte = buf[0];

            // Ctrl+C → abort
            if (byte === 0x03) {
                writeSync(fd, Buffer.from('^C\n'));
                throw new Error('User interrupted (Ctrl+C)');
            }

            // Ctrl+D → EOF
            if (byte === 0x04) break;

            // Newline (LF or CR) → done
            if (byte === 0x0a) {
                writeSync(fd, Buffer.from('\n'));
                break;
            }
            if (byte === 0x0d) {
                // CR — could be CRLF; break and discard any trailing LF
                // (fd will be closed so orphaned LF is harmless)
                writeSync(fd, Buffer.from('\n'));
                break;
            }

            // Backspace (BS 0x08 or DEL 0x7f)
            if (byte === 0x08 || byte === 0x7f) {
                if (line.length > 0) {
                    line = line.slice(0, -1);
                    writeSync(fd, Buffer.from('\b \b')); // erase on screen
                }
                continue;
            }

            // Ctrl+U → kill line
            if (byte === 0x15) {
                for (let i = 0; i < line.length; i++) {
                    writeSync(fd, Buffer.from('\b \b'));
                }
                line = '';
                continue;
            }

            // Printable ASCII → accept and echo
            if (byte >= 0x20 && byte <= 0x7e) {
                line += String.fromCharCode(byte);
                writeSync(fd, buf, 0, 1, null); // echo to terminal
            }
            // Ignore other control characters
        }

        return line;
    } finally {
        closeSync(fd);
    }
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
                        version: '0.5.4',
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
