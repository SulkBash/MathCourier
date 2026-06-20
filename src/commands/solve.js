const solver = require('../solver');
const renderer = require('../renderer');

async function handleSolveCommand(input) {
    const solveRes = solver.solveEquation(input);
    if (!solveRes.success) {
        return { success: false, error: solveRes.error };
    }
    return await renderer.render(solveRes.latex, true);
}

module.exports = handleSolveCommand;
