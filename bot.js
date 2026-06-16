const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const renderer = require('./renderer');
const config = require('./config');
const { create, all } = require('mathjs');
const math = create(all);

// Define custom function aliases for user convenience
math.import({
    // Inverse trigonometric aliases
    arcsin: math.asin,
    arccos: math.acos,
    arctan: math.atan,
    arccot: math.acot,
    arcsec: math.asec,
    arccsc: math.acsc,
    
    // Hyperbolic inverse trigonometric aliases
    arcsinh: math.asinh,
    arccosh: math.acosh,
    arctanh: math.atanh,
    arccoth: math.acoth,
    arcsech: math.asech,
    arccsch: math.acsch,

    // Cosecant aliases
    cosec: math.csc,
    cosech: math.csch,

    // Natural logarithm alias
    ln: math.log,

    // Tangent/cotangent shorthand aliases
    tg: math.tan,
    ctg: math.cot,
    arctg: math.atan,
    arcctg: math.acot
}, { override: true });


// Initialize the WhatsApp Client with LocalAuth for persistent sessions
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        // Pass the puppeteer arguments from config to prevent sandboxing issues
        args: config.puppeteer.launchArgs.args,
        headless: config.puppeteer.launchArgs.headless
    }
});

// Generate and display the QR code in the terminal
client.on('qr', (qr) => {
    console.log('\n--- SCAN THIS QR CODE WITH WHATSAPP LINKED DEVICES ---');
    qrcode.generate(qr, { small: true });
    console.log('-------------------------------------------------------\n');
});

// Connection state logging events
client.on('authenticated', () => {
    console.log('✅ Authentication successful.');
});

client.on('auth_failure', (msg) => {
    console.error('❌ Authentication failure:', msg);
});

client.on('change_state', (state) => {
    console.log(`ℹ️ Connection state changed: ${state}`);
});

client.on('disconnected', (reason) => {
    console.error('❌ Client was logged out / disconnected:', reason);
});

// Bot is authenticated and connected
client.on('ready', async () => {
    console.log(`\n==================================================`);
    console.log(`Bot "${config.bot.name}" is now connected and ready!`);
    console.log(`Listening for commands in group chats and direct messages.`);
    console.log(`==================================================\n`);
    
    // Initialize the LaTeX renderer
    await renderer.initialize();
});

// Listen to all messages (incoming and self-sent) to allow self-rendering
client.on('message_create', async (msg) => {
    // Basic guards
    if (!msg.body || typeof msg.body !== 'string') return;

    // Log potential triggers for debugging
    const body = msg.body.trim();
    const isPotentialTrigger = body.startsWith('!') || body.includes('$$');
    if (isPotentialTrigger) {
        const snippet = body.substring(0, 40).replace(/\n/g, ' ');
        console.log(`📥 Msg received from [${msg.author || msg.from}]: "${snippet}${body.length > 40 ? '...' : ''}"`);
    }
    
    let isLaTeXTrigger = false;
    let isCommand = false;
    let isChemCommand = false;
    let isTikzCommand = false;
    let isPlotCommand = false;
    let latexInput = '';

    // 1. Check for Command trigger: !latex or !tex
    if (body.startsWith('!latex ') || body.startsWith('!tex ')) {
        isCommand = true;
        isLaTeXTrigger = true;
        
        // Extract everything after the trigger command
        const firstSpaceIndex = body.indexOf(' ');
        latexInput = body.substring(firstSpaceIndex + 1).trim();
    } 
    // 2. Check for Chemistry Command trigger: !chem or !chemfig
    else if (body.startsWith('!chem ') || body.startsWith('!chemfig ')) {
        isChemCommand = true;
        isLaTeXTrigger = true;
        
        // Extract everything after the trigger command
        const firstSpaceIndex = body.indexOf(' ');
        latexInput = body.substring(firstSpaceIndex + 1).trim();
    }
    // 3. Check for TikZ Command trigger: !tikz
    else if (body.startsWith('!tikz ')) {
        isTikzCommand = true;
        isLaTeXTrigger = true;
        
        // Extract everything after the trigger command
        const firstSpaceIndex = body.indexOf(' ');
        latexInput = body.substring(firstSpaceIndex + 1).trim();
    }
    // 4. Check for Plot Command trigger: !plot
    else if (body.startsWith('!plot ')) {
        isPlotCommand = true;
        isLaTeXTrigger = true;
        
        // Extract everything after the trigger command
        const firstSpaceIndex = body.indexOf(' ');
        latexInput = body.substring(firstSpaceIndex + 1).trim();
    }
    // 5. Check for explicit TikZ environment trigger
    else if (body.includes('\\begin{tikzpicture}')) {
        isTikzCommand = true;
        isLaTeXTrigger = true;
        latexInput = body;
    }
    // 6. Check for Inline Block trigger: $$ equation $$
    else if (config.bot.autoRenderBlock && body.includes('$$')) {
        // Verify there is a closing $$ as well
        const firstIndex = body.indexOf('$$');
        const lastIndex = body.lastIndexOf('$$');
        
        if (firstIndex !== lastIndex) {
            isLaTeXTrigger = true;
            latexInput = body; // Send full text for mixed rendering
        }
    }

    // Process the LaTeX if triggered
    if (isLaTeXTrigger) {
        console.log(`⚙️ Processing LaTeX request for trigger...`);
        try {
            // Safe typing indicator block
            try {
                const chat = await msg.getChat();
                await chat.sendStateTyping();
            } catch (typingErr) {
                console.warn('⚠️ Warning: Failed to set typing state:', typingErr.message);
            }
            
            console.log(`Processing LaTeX request from: ${msg.author || msg.from}`);
            
            let renderResult;
            if (isChemCommand) {
                // Chemistry mode: Render chemfig diagram using QuickLaTeX
                renderResult = await renderer.renderChem(latexInput);
            } else if (isTikzCommand) {
                // TikZ mode: Render TikZ graphics using QuickLaTeX
                renderResult = await renderer.renderTikz(latexInput);
            } else if (isPlotCommand) {
                // Plot mode: Render function/equation plot
                renderResult = await handlePlotCommand(latexInput);
            } else if (isCommand) {
                // Command mode: Render single block equation directly
                renderResult = await renderer.render(latexInput, true);
            } else {
                // Auto-detect mode: Render full message as mixed text + math
                // We will evaluate the mixed text rendering inside Puppeteer
                renderResult = await renderMixed(latexInput);
            }

            if (renderResult.success && renderResult.data) {
                // Convert the base64 output into a WhatsApp media object
                const media = new MessageMedia('image/png', renderResult.data, 'latex.png');
                
                // Reply directly to the message containing the LaTeX
                await msg.reply(media);
                console.log(`Successfully replied with rendered LaTeX (Source: ${renderResult.source})`);
            } else {
                // Reply with the formatted LaTeX error
                await msg.reply(`${config.bot.errorPrefix}${renderResult.error}`);
                console.log(`Failed to render LaTeX: ${renderResult.error}`);
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
});

/**
 * Helper to handle mixed rendering of text + equations ($$...$$) in Puppeteer.
 * Falls back to extracting the equation for Codecogs if Puppeteer is offline.
 */
async function renderMixed(text) {
    if (renderer.isLocalReady()) {
        try {
            // Evaluates mixed text render via local Puppeteer template
            // We use the page object from renderer, which we wrap
            const result = await renderer.render(text, false);
            return result;
        } catch (err) {
            console.warn('Local mixed rendering failed, falling back to basic extraction...');
        }
    }

    // Fallback: If local renderer is offline, extract the first block equation and send to Codecogs
    const firstIndex = text.indexOf('$$');
    const secondIndex = text.indexOf('$$', firstIndex + 2);
    
    if (firstIndex !== -1 && secondIndex !== -1) {
        const extractedFormula = text.substring(firstIndex + 2, secondIndex).trim();
        if (extractedFormula) {
            console.log(`Fallback API: Rendering extracted formula: ${extractedFormula}`);
            return await renderer.render(extractedFormula, true);
        }
    }
    
    return {
        success: false,
        error: 'Local mixed rendering unavailable, and could not extract formula for API fallback.'
    };
}

/**
 * Helper to handle function and equation plotting commands.
 * Parses range matches from the input and triggers the renderer.
 */
async function handlePlotCommand(input) {
    let expr = input.trim();
    
    // Parse custom domains/ranges like [-5, 5]
    const rangeMatches = [...expr.matchAll(/\[([^\]]+)\]/g)];
    
    let xDomain = null;
    let yDomain = null;
    let cleanExpr = expr;

    if (rangeMatches.length > 0) {
        try {
            const xRangeParts = rangeMatches[0][1].split(',');
            const xMinVal = math.evaluate(xRangeParts[0].trim());
            const xMaxVal = math.evaluate(xRangeParts[1].trim());
            if (!isNaN(xMinVal) && !isNaN(xMaxVal) && xMinVal < xMaxVal) {
                xDomain = [xMinVal, xMaxVal];
            }
            // Remove the match from the expression
            cleanExpr = cleanExpr.replace(rangeMatches[0][0], '');
        } catch (e) {
            console.warn('Failed to parse X domain constraint:', e.message);
        }
    }
    
    if (rangeMatches.length > 1) {
        try {
            const yRangeParts = rangeMatches[1][1].split(',');
            const yMinVal = math.evaluate(yRangeParts[0].trim());
            const yMaxVal = math.evaluate(yRangeParts[1].trim());
            if (!isNaN(yMinVal) && !isNaN(yMaxVal) && yMinVal < yMaxVal) {
                yDomain = [yMinVal, yMaxVal];
            }
            // Remove the match from the expression
            cleanExpr = cleanExpr.replace(rangeMatches[1][0], '');
        } catch (e) {
            console.warn('Failed to parse Y domain constraint:', e.message);
        }
    }
    
    cleanExpr = cleanExpr.trim();
    
    const customOptions = {};
    if (xDomain) customOptions.xDomain = xDomain;
    if (yDomain) customOptions.yDomain = yDomain;
    
    return await renderer.renderPlot(cleanExpr, customOptions);
}

// Start the WhatsApp Bot
console.log('Starting LaTeX Render Bot...');
client.initialize().catch(err => {
    console.error('Failed to initialize WhatsApp client:', err);
});
