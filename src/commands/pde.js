const solver = require('../solver');
const renderer = require('../renderer');

async function handlePdeCommand(input) {
    let expr = input.trim();
    let isAnimated = false;
    let animationAxis = 'z';
    let animationMode = 'swing';
    let animationAngle = null;
    let is2d = false;

    let flagMatched = true;
    while (flagMatched) {
        flagMatched = false;
        expr = expr.trim();

        // 1. Match animation flags: -a, -ax, -ay, -az, or orbit variants like -az180
        const matchAnim = expr.match(/^-a(x|y|z)?(\d+)?(?=\s|$)/i);
        if (matchAnim) {
            isAnimated = true;
            const axis = matchAnim[1] ? matchAnim[1].toLowerCase() : 'z';
            const angleStr = matchAnim[2];

            animationAxis = axis;
            if (angleStr) {
                animationMode = 'orbit';
                animationAngle = parseInt(angleStr, 10);
            } else {
                animationMode = 'swing';
                animationAngle = null;
            }

            expr = expr.slice(matchAnim[0].length).trim();
            flagMatched = true;
            continue;
        }

        // 2. Match -2d flag
        const match2d = expr.match(/^-2d(?=\s|$)/i);
        if (match2d) {
            is2d = true;
            expr = expr.slice(match2d[0].length).trim();
            flagMatched = true;
            continue;
        }
    }

    // Call the solver
    const pdeRes = await solver.solvePde(expr);
    if (!pdeRes.success) {
        return { success: false, error: pdeRes.error };
    }

    // Call the renderer
    return await renderer.renderPde(pdeRes, {
        is2d,
        isAnimated,
        animationAxis,
        animationMode,
        animationAngle
    });
}

module.exports = handlePdeCommand;
