const solver = require('../solver');
const renderer = require('../renderer');
const { parseCommandSyntax, normalizeAndValidate } = require('../parser');

async function handlePdeCommand(input) {
    const rawParsed = parseCommandSyntax(input);
    const parsed = normalizeAndValidate(rawParsed, 'pde');
    if (!parsed.success) {
        return { success: false, error: parsed.errors.join('\n') };
    }

    const is2d = parsed.options.view === '2d';
    const isAnimated = !!parsed.options.camera;
    let animationAxis = 'z';
    let animationMode = 'swing';
    let animationAngle = null;

    if (parsed.options.camera) {
        animationAxis = parsed.options.camera.axis;
        animationAngle = parsed.options.camera.angle;
        animationMode = parsed.options.camera.angle !== null ? 'orbit' : 'swing';
    }

    // Call the solver
    const pdeRes = await solver.solvePde(input);
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
