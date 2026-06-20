const solver = require('../solver');
const renderer = require('../renderer');

async function handleRearrangeCommand(input) {
    const rearrangeRes = await solver.rearrangeEquation(input);
    if (!rearrangeRes.success) {
        return { success: false, error: rearrangeRes.error };
    }
    return await renderer.render(rearrangeRes.latex, true);
}

module.exports = handleRearrangeCommand;
