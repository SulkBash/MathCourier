const renderer = require('../renderer');
const { parseCommandSyntax, normalizeAndValidate } = require('../parser');

async function handlePlot3dCommand(input) {
    const rawParsed = parseCommandSyntax(input);
    // Since this is plot3d command, force view to be 3d
    rawParsed.options.view = '3d';
    const parsed = normalizeAndValidate(rawParsed, 'plot');
    if (!parsed.success) {
        return { success: false, error: parsed.errors.join('\n') };
    }

    const expr = parsed.body;
    if (!expr) {
        return { success: false, error: 'No expression provided for plotting.' };
    }

    const isAnimated = !!parsed.options.camera || !!parsed.options.animate;
    const isCameraAnimated = !!parsed.options.camera;
    const isEvolutionAnimated = !!parsed.options.animate;
    const evolutionVar = parsed.options.animate || null;
    
    let animationAxis = 'z';
    let animationMode = 'swing';
    let animationAngle = null;

    if (parsed.options.camera) {
        animationAxis = parsed.options.camera.axis;
        animationAngle = parsed.options.camera.angle;
        animationMode = parsed.options.camera.angle !== null ? 'orbit' : 'swing';
    }

    const labeledDomains = {};
    for (const r of parsed.ranges) {
        labeledDomains[r.name] = [r.min, r.max];
    }

    const opts = {
        isAnimated,
        isCameraAnimated,
        isEvolutionAnimated,
        evolutionVar,
        animationMode,
        animationAxis,
        animationAngle,
        labeledDomains,
        kind: parsed.options.kind || undefined,
        variables: parsed.variables.map((entry) => entry.name),
        isFlux: true
    };

    return await renderer.renderPlot3d(expr, opts);
}

module.exports = handlePlot3dCommand;
