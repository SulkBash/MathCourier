const katexModule = require('./katex');
const { renderPlot, renderOde } = require('./plot');
const { renderChem, renderTikz } = require('./quicklatex');
const { isRateLimited } = require('../middleware/rateLimit');
const { validateInputLength } = require('../middleware/validate');
const config = require('../../config');
const { renderFallback } = require('./codecogs');

async function render(formula, isBlock = true) {
    if (katexModule.isInitialized()) {
        try {
            return await katexModule.renderLocal(formula, isBlock);
        } catch (err) {
            console.warn('Local render failed:', err.message, '— trying fallback...');
        }
    }

    if (config.bot.useFallback) return await renderFallback(formula);

    return { success: false, error: 'Local renderer not ready, and Web API Fallback is disabled.' };
}

module.exports = {
    initialize: katexModule.initialize,
    render,
    renderChem,
    renderTikz,
    renderPlot,
    renderOde,
    close: katexModule.close,
    isLocalReady: () => katexModule.isInitialized(),
    isRateLimited,
    validateInputLength
};
