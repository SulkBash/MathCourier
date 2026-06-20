const math = require('../math');
const renderer = require('../renderer');

async function handlePlot3dCommand(input) {
    let expr = input.trim();
    let isAnimated = false;
    let animationMode = 'swing';
    let isFlux = true;

    const animationFlags = [
        { flag: '-a360', mode: 'orbit' },
        { flag: '-a', mode: 'swing' }
    ];

    let flagMatched = true;

    while (flagMatched) {
        flagMatched = false;
        expr = expr.trim();

        for (const { flag, mode } of animationFlags) {
            if (expr === flag || expr.startsWith(flag + ' ')) {
                isAnimated = true;
                animationMode = mode;
                expr = expr.slice(flag.length).trim();
                flagMatched = true;
                break;
            }
        }
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

    const opts = { isAnimated, animationMode, isFlux };
    if (xDomain) opts.xDomain = xDomain;
    if (yDomain) opts.yDomain = yDomain;
    if (zDomain) opts.zDomain = zDomain;

    return await renderer.renderPlot3d(expr, opts);
}

module.exports = handlePlot3dCommand;
