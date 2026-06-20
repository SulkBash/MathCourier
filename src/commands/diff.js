const solver = require('../solver');
const renderer = require('../renderer');

async function handleDiffCommand(input) {
    const diffRes = await solver.solveDerivative(input);
    if (!diffRes.success) {
        return { success: false, error: diffRes.error };
    }
    return await renderer.render(diffRes.latex, true);
}

module.exports = handleDiffCommand;
