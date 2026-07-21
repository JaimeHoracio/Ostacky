#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { openSync, readSync, writeSync, closeSync, readFileSync, readlinkSync } from 'fs';

function log(event, data) {
    const ts = new Date().toISOString();
    const payload = data ? ` ${JSON.stringify(data)}` : '';
    console.error(`[${ts}] ${event}${payload}`);
}

function findParentTTY() {
    try {
        const stat = readFileSync('/proc/self/stat', 'utf-8');
        const parts = stat.split(' ');
        const ttyNr = parseInt(parts[6], 10);
        if (ttyNr !== 0) {
            const major = (ttyNr >> 8) & 0xfff;
            const minor = (ttyNr & 0xff) | ((ttyNr >> 12) & 0xfff00);
            if (major === 136) return `/dev/pts/${minor}`;
            if (major === 4) return `/dev/tty${minor}`;
            if (major === 3) return `/dev/tty`;
        }
    } catch {}

    let pid = process.ppid;
    for (let i = 0; i < 10; i++) {
        try {
            const fd0 = readlinkSync(`/proc/${pid}/fd/0`);
            if (fd0.startsWith('/dev/pts/') || fd0.startsWith('/dev/tty')) {
                try {
                    const testFd = openSync(fd0, 'r+');
                    closeSync(testFd);
                    return fd0;
                } catch {}
            }
        } catch {}
        try {
            const stat = readFileSync(`/proc/${pid}/stat`, 'utf-8');
            pid = parseInt(stat.split(' ')[3], 10);
            if (pid <= 1) break;
        } catch {
            break;
        }
    }
    return null;
}

async function readLineFromTTY(prompt) {
    if (process.platform !== 'win32') {
        try {
            return readLineFromTTYSync(prompt || '> ');
        } catch (err) {
            log(`PTY read failed: ${err.message}`);
        }
    }
    log('No terminal available, reading from stdin. ' + "If the prompt doesn't appear, check terminal settings.");
    const { createInterface } = await import('readline');
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    return await new Promise((resolve) => {
        rl.question(prompt || '> ', (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

function readLineFromTTYSync(prompt) {
    const ttyPath = findParentTTY();
    if (!ttyPath) throw new Error('No TTY found for parent process');
    const fd = openSync(ttyPath, 'r+');
    try {
        writeSync(fd, Buffer.from(prompt, 'utf-8'), 0, Buffer.byteLength(prompt, 'utf-8'), null);
        const buf = Buffer.alloc(1);
        let line = '';
        while (true) {
            const bytesRead = readSync(fd, buf, 0, 1, null);
            if (bytesRead === 0) break;
            const byte = buf[0];
            if (byte === 0x03) {
                writeSync(fd, Buffer.from('^C\n'));
                throw new Error('User interrupted (Ctrl+C)');
            }
            if (byte === 0x04) break;
            if (byte === 0x0a) {
                writeSync(fd, Buffer.from('\n'));
                break;
            }
            if (byte === 0x0d) {
                writeSync(fd, Buffer.from('\n'));
                break;
            }
            if (byte === 0x08 || byte === 0x7f) {
                if (line.length > 0) {
                    line = line.slice(0, -1);
                    writeSync(fd, Buffer.from('\b \b'));
                }
                continue;
            }
            if (byte === 0x15) {
                for (let i = 0; i < line.length; i++) writeSync(fd, Buffer.from('\b \b'));
                line = '';
                continue;
            }
            if (byte >= 0x20 && byte <= 0x7e) {
                line += String.fromCharCode(byte);
                writeSync(fd, buf, 0, 1, null);
            }
        }
        return line;
    } finally {
        closeSync(fd);
    }
}

const server = new McpServer({
    name: 'ask-user-server',
    version: '0.5.5',
});

server.registerTool(
    'ask_user',
    {
        description:
            'Ask the user a question and block execution until they respond. ' +
            'Use this whenever you need a decision, confirmation, or input from the user.',
        inputSchema: z.object({
            question: z.string().describe('The question to ask the user.'),
            options: z.array(z.string()).optional().describe('Predefined answer options (optional).'),
            context: z.string().optional().describe('Additional context to display before the question (optional).'),
        }),
    },
    async ({ question, options, context }) => {
        const start = Date.now();
        log('tool:ask_user', { question_length: question.length });

        if (context) console.error(`\n${context}`);
        console.error(`\n\u2753 ${question}`);
        if (options && options.length > 0) {
            console.error(`Opciones: ${options.join(', ')}`);
        }

        const answer = await readLineFromTTY('> ');

        if (options && options.length > 0 && !options.includes(answer)) {
            console.error(`\u26a0\ufe0f  Respuesta no est\u00e1 entre las opciones: ${options.join(', ')}`);
            console.error(`Se usar\u00e1 igual: "${answer}"`);
        }

        log('tool:ask_user:ok', { ms: Date.now() - start });
        return { content: [{ type: 'text', text: JSON.stringify({ answer }) }] };
    }
);

async function main() {
    log('Starting ask-user-server MCP...');
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log('ask-user-server connected and ready');
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
