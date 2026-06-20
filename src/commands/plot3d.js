const math = require('../math');
const renderer = require('../renderer');

async function handlePlot3dCommand(input) {
    let expr = input.trim();
    let isAnimated = false;

    // Check for animation flag -a
    if (expr.startsWith('-a ')) {
        isAnimated = true;
        expr = expr.slice(3).trim();
    } else if (expr.startsWith('-a') && (expr[2] === undefined || /\s/.test(expr[2]))) {
        isAnimated = true;
        expr = expr.slice(2).trim();
    }

    const rangeMatches = [...expr.matchAll(/\[([^\]]+)\]/g)];

    let xDomain = null;
    let yDomain = null;
    let zDomain = null;

    // Up to 3 domains: [xMin, xMax], [yMin, yMax], [zMin, zMax]
    if (rangeMatches.length > 0) {
        try {
            const parts = rangeMatches[0][1].split(',');
            const lo = math.evaluate(parts[0].trim());
            const hi = math.evaluate(parts[1].trim());
            if (typeof lo === 'number' && typeof hi === 'number' && !isNaN(lo) && !isNaN(hi) && isFinite(lo) && isFinite(hi) && lo < hi) {
                xDomain = [lo, hi];
            }
            expr = expr.replace(rangeMatches[0][0], '');
        } catch (e) {
            console.warn('Failed to parse domain 1:', e.message);
        }
    }

    if (rangeMatches.length > 1) {
        try {
            const parts = rangeMatches[1][1].split(',');
            const lo = math.evaluate(parts[0].trim());
            const hi = math.evaluate(parts[1].trim());
            if (typeof lo === 'number' && typeof hi === 'number' && !isNaN(lo) && !isNaN(hi) && isFinite(lo) && isFinite(hi) && lo < hi) {
                yDomain = [lo, hi];
            }
            expr = expr.replace(rangeMatches[1][0], '');
        } catch (e) {
            console.warn('Failed to parse domain 2:', e.message);
        }
    }

    if (rangeMatches.length > 2) {
        try {
            const parts = rangeMatches[2][1].split(',');
            const lo = math.evaluate(parts[0].trim());
            const hi = math.evaluate(parts[1].trim());
            if (typeof lo === 'number' && typeof hi === 'number' && !isNaN(lo) && !isNaN(hi) && isFinite(lo) && isFinite(hi) && lo < hi) {
                zDomain = [lo, hi];
            }
            expr = expr.replace(rangeMatches[2][0], '');
        } catch (e) {
            console.warn('Failed to parse domain 3:', e.message);
        }
    }

    expr = expr.trim();

    const opts = { isAnimated };
    if (xDomain) opts.xDomain = xDomain;
    if (yDomain) opts.yDomain = yDomain;
    if (zDomain) opts.zDomain = zDomain;

    return await renderer.renderPlot3d(expr, opts);
}

module.exports = handlePlot3dCommand;
