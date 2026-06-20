const math = require('../math');
const renderer = require('../renderer');

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
            if (typeof lo === 'number' && typeof hi === 'number' && !isNaN(lo) && !isNaN(hi) && isFinite(lo) && isFinite(hi) && lo < hi) xDomain = [lo, hi];
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
            if (typeof lo === 'number' && typeof hi === 'number' && !isNaN(lo) && !isNaN(hi) && isFinite(lo) && isFinite(hi) && lo < hi) yDomain = [lo, hi];
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

module.exports = handlePlotCommand;
