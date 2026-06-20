const math = require('../math');
const renderer = require('../renderer');

async function handlePlotCommand(input) {
    let expr = input.trim();
    let isAnimated = false;
    let animationVar = null;

    // Parse animation flag: -e, -ex, -et, -ea, etc.
    const matchAnim = expr.match(/^-e(?:\[([a-zA-Z][a-zA-Z0-9_]*)\]|([a-zA-Z]))?(?=\s|$)/i);
    if (matchAnim) {
        isAnimated = true;
        animationVar = matchAnim[1] ? matchAnim[1].toLowerCase() : null;
        expr = expr.slice(matchAnim[0].length).trim();
    }

    const rangeMatches = [...expr.matchAll(/\[([^\]]+)\]/g)];
    const domains = [];

    for (const match of rangeMatches) {
        try {
            const parts = match[1].split(',');
            const lo = math.evaluate(parts[0].trim());
            const hi = math.evaluate(parts[1].trim());
            if (typeof lo === 'number' && typeof hi === 'number' && !isNaN(lo) && !isNaN(hi) && isFinite(lo) && isFinite(hi) && lo < hi) {
                domains.push([lo, hi]);
            }
            expr = expr.replace(match[0], '');
        } catch (e) {
            console.warn('Failed to parse domain:', e.message);
        }
    }

    expr = expr.trim();

    const opts = {
        isAnimated,
        animationVar
    };

    if (domains.length > 0) {
        opts.domains = domains;
    }

    return await renderer.renderPlot(expr, opts);
}

module.exports = handlePlotCommand;
