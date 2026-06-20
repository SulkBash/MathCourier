const solver = require('../solver');
const renderer = require('../renderer');

async function handleOdeCommand(input) {
    const odeRes = await solver.solveOde(input);
    if (!odeRes.success) {
        return { success: false, error: odeRes.error };
    }

    const latexText = odeRes.has_symbolic ? odeRes.symbolic_latex : odeRes.ode_latex;

    // Determine Y domain if not explicitly provided
    let yDomain = odeRes.yDomain;
    if (!yDomain) {
        let yValues = [];
        Object.values(odeRes.curves).forEach(points => {
            points.forEach(pt => {
                if (pt.y !== null && !isNaN(pt.y) && isFinite(pt.y)) {
                    yValues.push(pt.y);
                }
            });
        });

        if (yValues.length > 0) {
            const minVal = Math.min(...yValues);
            const maxVal = Math.max(...yValues);
            const range = maxVal - minVal;
            const pad = Math.max(range * 0.15, 1.0); // 15% padding
            yDomain = [minVal - pad, maxVal + pad];
        } else {
            yDomain = [-10, 10];
        }
    }

    return await renderer.renderOde(latexText, odeRes.curves, {
        xDomain: odeRes.xDomain,
        yDomain: yDomain
    });
}

module.exports = handleOdeCommand;
