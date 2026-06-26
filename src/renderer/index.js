const katexModule = require('./katex');
const { renderPlot, renderOde } = require('./plot');
const { renderPlot3d } = require('./plot3d');
const { renderPde } = require('./pde');
const { renderChem, renderTikz } = require('./quicklatex');
const { createJobQueue } = require('./jobQueue');
const { isRateLimited } = require('../middleware/rateLimit');
const { validateInputLength } = require('../middleware/validate');
const config = require('../../config');
const { renderFallback } = require('./codecogs');

const MAX_RENDER_CONCURRENCY = Math.max(1, Number(config.bot?.renderMaxConcurrency) || 8);
const MAX_RENDER_QUEUE = Math.max(0, Number(config.bot?.renderMaxQueue) || 128);

const isolatedRenderQueue = createJobQueue({
    concurrency: MAX_RENDER_CONCURRENCY,
    maxQueue: MAX_RENDER_QUEUE,
    name: 'Renderer queue'
});

async function runWithIsolatedPage(task, options = {}) {
    const requiresLocalPage = options.requiresLocalPage !== false;

    return isolatedRenderQueue.run(async () => {
        let renderPage = null;

        try {
            if (katexModule.isInitialized()) {
                renderPage = await katexModule.createRenderPage();
            } else if (requiresLocalPage) {
                throw new Error('Local renderer is not initialized.');
            }

            return await task(renderPage);
        } finally {
            if (renderPage) {
                try {
                    await renderPage.close();
                } catch (_) {}
            }
        }
    });
}

async function normalizeRendererJob(task) {
    try {
        return await task();
    } catch (err) {
        return {
            success: false,
            error: err && err.message ? err.message : 'Renderer job failed.'
        };
    }
}

async function render(formula, isBlock = true) {
    if (katexModule.isInitialized()) {
        try {
            return await runWithIsolatedPage((renderPage) => (
                katexModule.renderLocal(formula, isBlock, renderPage)
            ));
        } catch (err) {
            console.warn('Local render failed:', err.message, '- trying fallback...');
        }
    }

    if (config.bot.useFallback) {
        return renderFallback(formula);
    }

    return { success: false, error: 'Local renderer not ready, and Web API Fallback is disabled.' };
}

async function renderChemWrapped(formula) {
    if (!katexModule.isInitialized()) {
        return renderChem(formula);
    }

    return normalizeRendererJob(() => runWithIsolatedPage(
        (renderPage) => renderChem(formula, renderPage),
        { requiresLocalPage: false }
    ));
}

async function renderTikzWrapped(formula) {
    if (!katexModule.isInitialized()) {
        return renderTikz(formula);
    }

    return normalizeRendererJob(() => runWithIsolatedPage(
        (renderPage) => renderTikz(formula, renderPage),
        { requiresLocalPage: false }
    ));
}

async function renderPlotWrapped(rawExpr, customOptions) {
    return normalizeRendererJob(() => runWithIsolatedPage((renderPage) => renderPlot(rawExpr, customOptions, renderPage)));
}

async function renderPlot3dWrapped(rawExpr, customOptions) {
    return renderPlot3d(rawExpr, customOptions);
}

async function renderOdeWrapped(latexText, curves, customOptions) {
    return normalizeRendererJob(() => runWithIsolatedPage((renderPage) => renderOde(latexText, curves, customOptions, renderPage)));
}

async function renderPdeWrapped(pdeRes, customOptions = {}) {
    if (customOptions.is2d) {
        return normalizeRendererJob(() => runWithIsolatedPage((renderPage) => renderPde(pdeRes, customOptions, renderPage)));
    }

    return normalizeRendererJob(() => renderPde(pdeRes, customOptions));
}

module.exports = {
    initialize: katexModule.initialize,
    render,
    renderChem: renderChemWrapped,
    renderTikz: renderTikzWrapped,
    renderPlot: renderPlotWrapped,
    renderPlot3d: renderPlot3dWrapped,
    renderOde: renderOdeWrapped,
    renderPde: renderPdeWrapped,
    close: katexModule.close,
    isLocalReady: () => katexModule.isInitialized(),
    isRateLimited,
    validateInputLength,
    _internals: {
        getQueueStats: () => isolatedRenderQueue.getStats()
    }
};
