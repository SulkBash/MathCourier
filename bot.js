const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const renderer = require('./src/renderer');
const config = require('./config');

const handleLatexCommand = require('./src/commands/latex');
const handlePlotCommand = require('./src/commands/plot');
const handleSolveCommand = require('./src/commands/solve');
const helpText = require('./src/commands/help');

const READY_WATCHDOG_MS = 45000;

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: config.puppeteer.launchArgs.args,
        headless: config.puppeteer.launchArgs.headless
    }
});

let readyWatchdog = null;
let isShuttingDown = false;

function clearReadyWatchdog() {
    if (readyWatchdog) {
        clearTimeout(readyWatchdog);
        readyWatchdog = null;
    }
}

function armReadyWatchdog() {
    clearReadyWatchdog();
    readyWatchdog = setTimeout(() => {
        console.warn(`Still waiting for WhatsApp to become ready after ${READY_WATCHDOG_MS / 1000}s.`);
        console.warn('If this keeps happening, close any stale bot/Chromium process using .wwebjs_auth\\session and restart the bot.');
    }, READY_WATCHDOG_MS);

    if (typeof readyWatchdog.unref === 'function') {
        readyWatchdog.unref();
    }
}

async function shutdown(signal, exitCode = 0) {
    if (isShuttingDown) {
        return;
    }

    isShuttingDown = true;
    clearReadyWatchdog();
    console.log(`Shutting down bot (${signal})...`);

    await Promise.allSettled([
        client.destroy(),
        renderer.close()
    ]);

    process.exit(exitCode);
}

client.on('qr', (qr) => {
    console.log('\n--- SCAN THIS QR CODE WITH WHATSAPP LINKED DEVICES ---');
    qrcode.generate(qr, { small: true });
    console.log('-------------------------------------------------------\n');
});

client.on('authenticated', () => {
    console.log('Authenticated.');
    armReadyWatchdog();
});
client.on('auth_failure', (msg) => {
    clearReadyWatchdog();
    console.error('Auth failure:', msg);
});
client.on('change_state', (state) => console.log(`Connection state: ${state}`));
client.on('loading_screen', (percent, message) => {
    console.log(`Loading screen: ${percent}% ${message}`);
});
client.on('disconnected', (reason) => {
    clearReadyWatchdog();
    console.error('Disconnected:', reason);
});
client.on('remote_session_saved', () => {
    console.log('Remote session saved.');
});

client.on('ready', async () => {
    clearReadyWatchdog();
    console.log(`\n==================================================`);
    console.log(`Bot "${config.bot.name}" is now connected and ready!`);
    console.log(`==================================================\n`);
    try {
        await renderer.initialize();
    } catch (err) {
        console.error('Renderer initialization failed:', err);
    }
});

const COMMAND_REGISTRY = {
    latex: { handler: handleLatexCommand },
    plot: { handler: handlePlotCommand },
    solve: { handler: handleSolveCommand }
};

async function executeRegistryCommand(commandName, input) {
    const cmd = COMMAND_REGISTRY[commandName];
    if (!cmd) return { success: false, error: 'Unknown command' };

    if (typeof cmd.handler !== 'function') {
        return { success: false, error: `Command "!${commandName}" is not currently available.` };
    }

    return await cmd.handler(input);
}

function appendOption(input, optionToken) {
    const trimmedInput = String(input || '').trim();
    return trimmedInput ? `${trimmedInput} ${optionToken}` : optionToken;
}

function extractBangCommand(body) {
    const match = String(body || '').match(/^!([a-zA-Z][a-zA-Z0-9_]*)(?:\s+([\s\S]*))?$/);
    if (!match) {
        return null;
    }

    return {
        command: match[1].toLowerCase(),
        input: (match[2] || '').trim()
    };
}

function resolveCommandRoute(body) {
    const invocation = extractBangCommand(body);
    if (invocation) {
        if (COMMAND_REGISTRY[invocation.command]) {
            return {
                triggered: true,
                mode: invocation.command,
                input: invocation.input
            };
        }
    }

    if (body.includes('\\begin{tikzpicture}')) {
        return {
            triggered: true,
            mode: 'latex',
            input: appendOption(body, 'mode:tikz')
        };
    }

    if (config.bot.autoRenderBlock && body.includes('$$')) {
        const first = body.indexOf('$$');
        const last = body.lastIndexOf('$$');
        if (first !== last) {
            return {
                triggered: true,
                mode: 'mixed',
                input: body
            };
        }
    }

    return {
        triggered: false,
        mode: null,
        input: ''
    };
}

async function handleCommandMessage(msg) {
    if (!msg.body || typeof msg.body !== 'string') return;

    const body = msg.body.trim();
    if (typeof helpText.isHelpText === 'function' && helpText.isHelpText(body)) return;

    if (body.startsWith('!') || body.includes('$$')) {
        const snippet = body.substring(0, 40).replace(/\n/g, ' ');
        console.log(`msg from [${msg.author || msg.from}]: "${snippet}${body.length > 40 ? '...' : ''}"`);
    }

    const invocation = extractBangCommand(body);
    if (invocation && invocation.command === 'help') {
        try {
            const targetCmd = invocation.input ? invocation.input.trim() : '';
            await msg.reply(helpText(targetCmd));
        } catch (err) {
            console.error('Failed to send help message:', err.message);
        }
        return;
    }

    if (invocation && !COMMAND_REGISTRY[invocation.command]) {
        try {
            await msg.reply(
                `${config.bot.errorPrefix}Unknown command "!${invocation.command}". Use !help for the supported commands: !latex, !plot, !solve, !help.`
            );
        } catch (err) {
            console.error('Failed to send unknown-command reply:', err.message);
        }
        return;
    }

    const route = resolveCommandRoute(body);
    const { triggered, mode, input } = route;

    if (!triggered) return;

    // Rate limiting
    const sender = msg.author || msg.from;
    if (renderer.isRateLimited(sender)) {
        console.warn(`Rate limited: ${sender}`);
        try { await msg.reply(`${config.bot.errorPrefix}Too many requests. Please wait a moment before sending another formula.`); } catch (_) { }
        return;
    }

    const lengthErr = renderer.validateInputLength(input);
    if (lengthErr) {
        console.warn(`Input rejected (${sender}): ${lengthErr}`);
        try { await msg.reply(`${config.bot.errorPrefix}${lengthErr}`); } catch (_) { }
        return;
    }

    console.log(`Processing request from: ${sender}`);
    try {
        try {
            const chat = await msg.getChat();
            await chat.sendStateTyping();
        } catch (e) {
            console.warn('Failed to set typing state:', e.message);
        }

        let result;
        if (mode === 'mixed') {
            result = await renderMixed(input);
        } else if (COMMAND_REGISTRY[mode]) {
            result = await executeRegistryCommand(mode, input);
        } else {
            result = { success: false, error: 'Unknown command mode.' };
        }

        if (result.success && result.data) {
            const mimeType = result.mimeType || 'image/png';
            const filename = result.filename || 'latex.png';
            const media = new MessageMedia(mimeType, result.data, filename);
            const sendOpts = result.isAnimation ? { gifPlayback: true } : {};
            await msg.reply(media, undefined, sendOpts);
            console.log(`Replied with rendered image/video (source: ${result.source})`);
        } else {
            await msg.reply(`${config.bot.errorPrefix}${result.error}`);
            console.log(`Render failed: ${result.error}`);
        }
    } catch (err) {
        console.error('Error handling message:', err);
        try {
            await msg.reply(`${config.bot.errorPrefix}An unexpected error occurred during rendering.`);
        } catch (replyErr) {
            console.error('Failed to send error reply:', replyErr);
        }
    }
}

// `message` is the canonical incoming-message event.
client.on('message', handleCommandMessage);

// Keep `message_create` only for commands sent by the current account
// (for example, tests from your phone or another linked device).
client.on('message_create', async (msg) => {
    if (!msg.fromMe) {
        return;
    }

    await handleCommandMessage(msg);
});

/**
 * Renders mixed text+equations ($$...$$) locally, falling back to extracting
 * the first equation for the API if Puppeteer is down.
 */
async function renderMixed(text) {
    if (renderer.isLocalReady()) {
        try {
            return await renderer.render(text, false);
        } catch (err) {
            console.warn('Local mixed rendering failed, falling back...');
        }
    }

    // Fallback: extract the first $$ block and send it to the API
    const first = text.indexOf('$$');
    const second = text.indexOf('$$', first + 2);

    if (first !== -1 && second !== -1) {
        const extracted = text.substring(first + 2, second).trim();
        if (extracted) {
            console.log(`Fallback: rendering extracted formula: ${extracted}`);
            return await renderer.render(extracted, true);
        }
    }

    return {
        success: false,
        error: 'Local mixed rendering unavailable, and could not extract formula for API fallback.'
    };
}

console.log('Starting LaTeX Render Bot...');
client.initialize().catch(err => {
    clearReadyWatchdog();

    if (/browser is already running/i.test(err.message)) {
        console.error('Failed to initialize WhatsApp client: the WhatsApp session is already in use by another bot or stale Chromium process.');
        console.error('Close the other instance, or end the leftover Chrome process that is holding ".wwebjs_auth\\session", then restart.');
    } else {
        console.error('Failed to initialize WhatsApp client:', err);
    }

    process.exitCode = 1;
});

process.on('SIGINT', () => {
    shutdown('SIGINT').catch((err) => {
        console.error('Shutdown failed:', err);
        process.exit(1);
    });
});

process.on('SIGTERM', () => {
    shutdown('SIGTERM').catch((err) => {
        console.error('Shutdown failed:', err);
        process.exit(1);
    });
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
    shutdown('unhandledRejection', 1).catch((err) => {
        console.error('Shutdown failed:', err);
        process.exit(1);
    });
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    shutdown('uncaughtException', 1).catch((shutdownErr) => {
        console.error('Shutdown failed:', shutdownErr);
        process.exit(1);
    });
});
