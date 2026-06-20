const katexModule = require('./katex');
const { renderPlot, renderOde } = require('./plot');
const { renderPlot3d } = require('./plot3d');
const { renderChem, renderTikz } = require('./quicklatex');
const { isRateLimited } = require('../middleware/rateLimit');
const { validateInputLength } = require('../middleware/validate');
const config = require('../../config');
const { renderFallback } = require('./codecogs');

// Simple sequential execution queue to prevent concurrent rendering requests 
// from interfering with the shared singleton Puppeteer page instance.
let renderingMutex = Promise.resolve();

async function acquireLock() {
    let release;
    const nextLock = new Promise(resolve => {
        release = resolve;
    });
    const currentLock = renderingMutex;
    renderingMutex = nextLock;
    await currentLock;
    return release;
}

async function renderWithLock(fn) {
    const release = await acquireLock();
    try {
        return await fn();
    } finally {
        release();
    }
}

async function render(formula, isBlock = true) {
    return renderWithLock(async () => {
        if (katexModule.isInitialized()) {
            try {
                return await katexModule.renderLocal(formula, isBlock);
            } catch (err) {
                console.warn('Local render failed:', err.message, '— trying fallback...');
            }
        }

        if (config.bot.useFallback) return await renderFallback(formula);

        return { success: false, error: 'Local renderer not ready, and Web API Fallback is disabled.' };
    });
}

async function renderChemWrapped(formula) {
    return renderWithLock(() => renderChem(formula));
}

async function renderTikzWrapped(formula) {
    return renderWithLock(() => renderTikz(formula));
}

async function renderPlotWrapped(rawExpr, customOptions) {
    return renderWithLock(() => renderPlot(rawExpr, customOptions));
}

async function renderPlot3dWrapped(rawExpr, customOptions) {
    // 3D renders use isolated Puppeteer pages, so they can safely run
    // outside the shared singleton-page lock used by the other renderers.
    return renderPlot3d(rawExpr, customOptions);
}

async function renderOdeWrapped(latexText, curves, customOptions) {
    return renderWithLock(() => renderOde(latexText, curves, customOptions));
}

module.exports = {
    initialize: katexModule.initialize,
    render,
    renderChem: renderChemWrapped,
    renderTikz: renderTikzWrapped,
    renderPlot: renderPlotWrapped,
    renderPlot3d: renderPlot3dWrapped,
    renderOde: renderOdeWrapped,
    close: katexModule.close,
    isLocalReady: () => katexModule.isInitialized(),
    isRateLimited,
    validateInputLength
};
