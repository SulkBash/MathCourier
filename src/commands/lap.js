const solver = require('../solver');
const renderer = require('../renderer');

async function handleLapCommand(input) {
    const lapRes = solver.solveLaplacian(input);
    if (!lapRes.success) {
        return { success: false, error: lapRes.error };
    }
    return await renderer.render(lapRes.latex, true);
}

module.exports = handleLapCommand;
