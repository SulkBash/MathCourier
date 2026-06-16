const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const renderer = require('./renderer');
const config = require('./config');
const { create, all } = require('mathjs');
const math = create(all);

math.import({
    arcsin: math.asin,
    arccos: math.acos,
    arctan: math.atan,
    arccot: math.acot,
    arcsec: math.asec,
    arccsc: math.acsc,
    arcsinh: math.asinh,
    arccosh: math.acosh,
    arctanh: math.atanh,
    arccoth: math.acoth,
    arcsech: math.asech,
    arccsch: math.acsch,
    cosec: math.csc,
    cosech: math.csch,
    ln: math.log,
    tg: math.tan,
    ctg: math.cot,
    arctg: math.atan,
    arcctg: math.acot
}, { override: true });


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
    if (body.startsWith('!') || body.includes('$$')) {
        const snippet = body.substring(0, 40).replace(/\n/g, ' ');
        console.log(`msg from [${msg.author || msg.from}]: "${snippet}${body.length > 40 ? '...' : ''}"`);
    }
    
    let triggered = false;
    let mode = null;   // 'latex' | 'chem' | 'tikz' | 'plot' | 'mixed'
    let input = '';

    const latexInput = parseCommand(body, '!latex') || parseCommand(body, '!tex');
    const chemInput = parseCommand(body, '!chem') || parseCommand(body, '!chemfig');
    const tikzInput = parseCommand(body, '!tikz');
    const plotInput = parseCommand(body, '!plot');

    if (latexInput) {
        triggered = true; mode = 'latex'; input = latexInput;
    } else if (chemInput) {
        triggered = true; mode = 'chem'; input = chemInput;
    } else if (tikzInput) {
        triggered = true; mode = 'tikz'; input = tikzInput;
    } else if (plotInput) {
        triggered = true; mode = 'plot'; input = plotInput;
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
        try { await msg.reply(`${config.bot.errorPrefix}Too many requests. Please wait a moment before sending another formula.`); } catch (_) {}
        return;
    }

    const lengthErr = renderer.validateInputLength(input);
    if (lengthErr) {
        console.warn(`Input rejected (${sender}): ${lengthErr}`);
        try { await msg.reply(`${config.bot.errorPrefix}${lengthErr}`); } catch (_) {}
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
            result = await renderer.renderChem(input);
        } else if (mode === 'tikz') {
            result = await renderer.renderTikz(input);
        } else if (mode === 'plot') {
            result = await handlePlotCommand(input);
        } else if (mode === 'latex') {
            result = await renderer.render(input, true);
        } else {
            result = await renderMixed(input);
        }

        if (result.success && result.data) {
            const media = new MessageMedia('image/png', result.data, 'latex.png');
            await msg.reply(media);
            console.log(`Replied with rendered image (source: ${result.source})`);
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

async function handlePlotCommand(input) {
    let expr = input.trim();
    
    const rangeMatches = [...expr.matchAll(/\[([^\]]+)\]/g)];
    
    let xDomain = null;
    let yDomain = null;

    if (rangeMatches.length > 0) {
        try {
            const parts = rangeMatches[0][1].split(',');
            const lo = math.evaluate(parts[0].trim());
            const hi = math.evaluate(parts[1].trim());
            if (!isNaN(lo) && !isNaN(hi) && lo < hi) xDomain = [lo, hi];
            expr = expr.replace(rangeMatches[0][0], '');
        } catch (e) {
            console.warn('Failed to parse X domain:', e.message);
        }
    }
    
    if (rangeMatches.length > 1) {
        try {
            const parts = rangeMatches[1][1].split(',');
            const lo = math.evaluate(parts[0].trim());
            const hi = math.evaluate(parts[1].trim());
            if (!isNaN(lo) && !isNaN(hi) && lo < hi) yDomain = [lo, hi];
            expr = expr.replace(rangeMatches[1][0], '');
        } catch (e) {
            console.warn('Failed to parse Y domain:', e.message);
        }
    }
    
    expr = expr.trim();
    
    const opts = {};
    if (xDomain) opts.xDomain = xDomain;
    if (yDomain) opts.yDomain = yDomain;
    
    return await renderer.renderPlot(expr, opts);
}

console.log('Starting LaTeX Render Bot...');
client.initialize().catch(err => {
    console.error('Failed to initialize WhatsApp client:', err);
});
