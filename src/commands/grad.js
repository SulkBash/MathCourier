const solver = require('../solver');
const renderer = require('../renderer');

async function handleGradCommand(input) {
    const gradRes = solver.solveGradient(input);
    if (!gradRes.success) {
        return { success: false, error: gradRes.error };
    }
    return await renderer.render(gradRes.latex, true);
}

module.exports = handleGradCommand;
