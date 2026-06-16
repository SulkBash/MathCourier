const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const renderer = require('./renderer');
const config = require('./config');

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

    // Normalize message body for trigger checking
    const body = msg.body.trim();
    
    let isLaTeXTrigger = false;
    let isCommand = false;
    let latexInput = '';

    // 1. Check for Command trigger: !latex or !tex
    if (body.startsWith('!latex ') || body.startsWith('!tex ')) {
        isCommand = true;
        isLaTeXTrigger = true;
        
        // Extract everything after the trigger command
        const firstSpaceIndex = body.indexOf(' ');
        latexInput = body.substring(firstSpaceIndex + 1).trim();
    } 
    // 2. Check for Inline Block trigger: $$ equation $$
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
        // Indicate to the user that the bot is processing (optional, typing status)
        try {
            const chat = await msg.getChat();
            await chat.sendStateTyping();
            
            console.log(`Processing LaTeX request from: ${msg.author || msg.from}`);
            
            let renderResult;
            if (isCommand) {
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

// Start the WhatsApp Bot
console.log('Starting LaTeX Render Bot...');
client.initialize().catch(err => {
    console.error('Failed to initialize WhatsApp client:', err);
});
