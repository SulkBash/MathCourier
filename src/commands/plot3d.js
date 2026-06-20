const math = require('../math');
const renderer = require('../renderer');

async function handlePlot3dCommand(input) {
    let expr = input.trim();
    let isAnimated = false;
    let isCameraAnimated = false;
    let isEvolutionAnimated = false;
    let evolutionVar = null;
    let animationAxis = 'z';
    let animationMode = 'swing';
    let animationAngle = null;
    let isFlux = true;

    let flagMatched = true;

    while (flagMatched) {
        flagMatched = false;
        expr = expr.trim();

        const match = expr.match(/^-a(x|y|z)?(\d+)?(?=\s|$)/i);
        if (match) {
            isAnimated = true;
            isCameraAnimated = true;
            const axis = match[1] ? match[1].toLowerCase() : 'z';
            const angleStr = match[2];

            animationAxis = axis;
            if (angleStr) {
                animationMode = 'orbit';
                animationAngle = parseInt(angleStr, 10);
            } else {
                animationMode = 'swing';
                animationAngle = null;
            }

            expr = expr.slice(match[0].length).trim();
            flagMatched = true;
            continue;
        }

        const matchEvolution = expr.match(/^-e(?:\[([a-zA-Z][a-zA-Z0-9_]*)\]|([a-zA-Z]))?(?=\s|$)/i);
        if (matchEvolution) {
            isAnimated = true;
            isEvolutionAnimated = true;
            evolutionVar = (matchEvolution[1] || matchEvolution[2] || '').toLowerCase() || null;
            expr = expr.slice(matchEvolution[0].length).trim();
            flagMatched = true;
        }
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
        isCameraAnimated,
        isEvolutionAnimated,
        evolutionVar,
        animationMode,
        animationAxis,
        animationAngle,
        isFlux
    };
    if (domains.length > 0) {
        opts.domains = domains;
    }

    return await renderer.renderPlot3d(expr, opts);
}

module.exports = handlePlot3dCommand;
