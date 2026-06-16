/**
 * Configuration settings for the WhatsApp LaTeX Render Bot.
 */
module.exports = {
    // Styling options for the rendered formula cards
    style: {
        // Slate-900 premium dark theme
        backgroundColor: '#0f172a',
        textColor: '#f8fafc',
        
        // Font options
        fontSize: '24px',
        fontFamily: "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        
        // Card padding and shape
        padding: '28px 32px',
        borderRadius: '16px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        
        // Box shadow for a premium floating card look
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3)',
        
        // Watermark styling
        watermark: {
            text: 'LaTeX Render Bot',
            color: 'rgba(248, 250, 252, 0.4)', // Faded text
            fontSize: '11px',
            fontFamily: "monospace"
        },
        
        // Graph plotting styles
        graph: {
            width: 600,
            height: 450,
            gridColor: 'rgba(255, 255, 255, 0.06)',
            axisColor: 'rgba(255, 255, 255, 0.3)',
            axisLabelColor: 'rgba(248, 250, 252, 0.5)',
            curveColors: ['#06b6d4', '#8b5cf6'], // Cyan to Purple gradient
            glowColor: 'rgba(6, 182, 212, 0.4)',
            glowBlur: 10,
            lineWidth: 3.5,
            defaultXDomain: [-10, 10],
            defaultYDomain: [-10, 10]
        }
    },

    // Bot triggers and options
    bot: {
        name: 'LaTeX Bot',
        // Auto-render messages wrapped in $$ ... $$
        autoRenderBlock: true,
        // Error response prefix
        errorPrefix: '⚠️ *LaTeX Error:* ',
        // Enable fallback API when local puppeteer fails
        useFallback: true,
        // The API fallback engine ('codecogs' or 'math.now')
        fallbackEngine: 'codecogs'
    },

    // Puppeteer launch settings
    puppeteer: {
        launchArgs: {
            headless: 'new',
            args: []
        }
    }
};
