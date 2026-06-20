const solver = require('../solver');
const renderer = require('../renderer');

async function handleDivCommand(input) {
    const divRes = solver.solveDivergence(input);
    if (!divRes.success) {
        return { success: false, error: divRes.error };
    }
    return await renderer.render(divRes.latex, true);
}

module.exports = handleDivCommand;
