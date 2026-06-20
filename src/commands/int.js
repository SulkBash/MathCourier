const solver = require('../solver');
const renderer = require('../renderer');

async function handleIntCommand(input) {
    const intRes = await solver.solveIntegral(input);
    if (!intRes.success) {
        return { success: false, error: intRes.error };
    }
    return await renderer.render(intRes.latex, true);
}

module.exports = handleIntCommand;
