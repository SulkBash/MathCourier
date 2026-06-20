const solver = require('../solver');
const renderer = require('../renderer');

async function handleMatrixCommand(input) {
    const matrixRes = solver.solveMatrixExpression(input);
    if (!matrixRes.success) {
        return { success: false, error: matrixRes.error };
    }
    return await renderer.render(matrixRes.latex, true);
}

module.exports = handleMatrixCommand;
