const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const renderer = require('./src/renderer');
const config = require('./config');

const handlePlotCommand = require('./src/commands/plot');
const handlePlot3dCommand = require('./src/commands/plot3d');
const handleSolveCommand = require('./src/commands/solve');
const handleRearrangeCommand = require('./src/commands/desp');
const handleDiffCommand = require('./src/commands/diff');
const handleIntCommand = require('./src/commands/int');
const handleOdeCommand = require('./src/commands/ode');
const handleLatexCommand = require('./src/commands/latex');
const handleChemCommand = require('./src/commands/chem');
const handleTikzCommand = require('./src/commands/tikz');
const helpText = require('./src/commands/help');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: config.puppeteer.launchArgs.args,
        headless: config.puppeteer.launchArgs.headless
    }
});

client.on('qr', (qr) => {
    console.log('\n--- SCAN THIS QR CODE WITH WHATSAPP LINKED DEVICES ---');
    qrcode.generate(qr, { small: true });
    console.log('-------------------------------------------------------\n');
});

client.on('authenticated', () => console.log('Authenticated.'));
client.on('auth_failure', (msg) => console.error('Auth failure:', msg));
client.on('change_state', (state) => console.log(`Connection state: ${state}`));
client.on('disconnected', (reason) => console.error('Disconnected:', reason));

client.on('ready', async () => {
    console.log(`\n==================================================`);
    console.log(`Bot "${config.bot.name}" is now connected and ready!`);
    console.log(`==================================================\n`);
    await renderer.initialize();
});

/**
 * Checks if `body` starts with `prefix + ' '` and returns the text after it,
 * or null if it doesn't match.
 */
function parseCommand(body, prefix) {
    if (body.startsWith(prefix + ' ')) {
        return body.slice(prefix.length + 1).trim();
    }
    return null;
}

client.on('message_create', async (msg) => {
    if (!msg.body || typeof msg.body !== 'string') return;

    const body = msg.body.trim();
    if (body.startsWith('*LaTeX Render Bot Help Menu*')) return;

    if (body.startsWith('!') || body.includes('$$')) {
        const snippet = body.substring(0, 40).replace(/\n/g, ' ');
        console.log(`msg from [${msg.author || msg.from}]: "${snippet}${body.length > 40 ? '...' : ''}"`);
    }

    if (body.toLowerCase() === '!help') {
        try {
            await msg.reply(helpText);
        } catch (err) {
            console.error('Failed to send help message:', err.message);
        }
        return;
    }

    let triggered = false;
    let mode = null;   // 'latex' | 'chem' | 'tikz' | 'plot' | 'solve' | 'mixed'
    let input = '';

    const latexInput = parseCommand(body, '!latex') || parseCommand(body, '!tex');
    const chemInput = parseCommand(body, '!chem') || parseCommand(body, '!chemfig');
    const tikzInput = parseCommand(body, '!tikz');
    const plotInput = parseCommand(body, '!plot');
    const plot3dInput = parseCommand(body, '!plot3d');
    const solveInput = parseCommand(body, '!solve');
    const odeInput = parseCommand(body, '!ode');
    const despInput = parseCommand(body, '!desp');
    const diffInput = parseCommand(body, '!diff');
    const intInput = parseCommand(body, '!int');

    if (latexInput) {
        triggered = true; mode = 'latex'; input = latexInput;
    } else if (chemInput) {
        triggered = true; mode = 'chem'; input = chemInput;
    } else if (tikzInput) {
        triggered = true; mode = 'tikz'; input = tikzInput;
    } else if (plotInput) {
        triggered = true; mode = 'plot'; input = plotInput;
    } else if (plot3dInput) {
        triggered = true; mode = 'plot3d'; input = plot3dInput;
    } else if (solveInput) {
        triggered = true; mode = 'solve'; input = solveInput;
    } else if (odeInput) {
        triggered = true; mode = 'ode'; input = odeInput;
    } else if (despInput) {
        triggered = true; mode = 'desp'; input = despInput;
    } else if (diffInput) {
        triggered = true; mode = 'diff'; input = diffInput;
    } else if (intInput) {
        triggered = true; mode = 'int'; input = intInput;
    } else if (body.includes('\\begin{tikzpicture}')) {
        triggered = true; mode = 'tikz'; input = body;
    } else if (config.bot.autoRenderBlock && body.includes('$$')) {
        const first = body.indexOf('$$');
        const last = body.lastIndexOf('$$');
        if (first !== last) {
            triggered = true; mode = 'mixed'; input = body;
        }
    }

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

    console.log(`Processing LaTeX request from: ${sender}`);
    try {
        try {
            const chat = await msg.getChat();
            await chat.sendStateTyping();
        } catch (e) {
            console.warn('Failed to set typing state:', e.message);
        }

        let result;
        if (mode === 'chem') {
            result = await handleChemCommand(input);
        } else if (mode === 'tikz') {
            result = await handleTikzCommand(input);
        } else if (mode === 'plot') {
            result = await handlePlotCommand(input);
        } else if (mode === 'plot3d') {
            result = await handlePlot3dCommand(input);
        } else if (mode === 'solve') {
            result = await handleSolveCommand(input);
        } else if (mode === 'ode') {
            result = await handleOdeCommand(input);
        } else if (mode === 'desp') {
            result = await handleRearrangeCommand(input);
        } else if (mode === 'diff') {
            result = await handleDiffCommand(input);
        } else if (mode === 'int') {
            result = await handleIntCommand(input);
        } else if (mode === 'latex') {
            result = await handleLatexCommand(input);
        } else {
            result = await renderMixed(input);
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
    console.error('Failed to initialize WhatsApp client:', err);
});
