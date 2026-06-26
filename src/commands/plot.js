const renderer = require('../renderer');
const { parseCommandSyntax, normalizeAndValidate } = require('../parser');

const LEGACY_2D_ANIMATION_PREFIX_RE = /^\s*-e(?:\[[A-Za-z][A-Za-z0-9_]*\]|[A-Za-z]+)(?=\s|$)/;

function legacy2dAnimationError() {
    return {
        success: false,
        error: 'Legacy 2D -e[...] animation syntax is no longer supported. Use a static 2D !plot command, or switch to view:3d with animate:<param> or camera:<axis> for animated output.'
    };
}

function unsupported2dAnimationError() {
    return {
        success: false,
        error: '2D animation is not supported in !plot. Use a static 2D plot, or switch to view:3d with animate:<param> or camera:<axis> for animated output.'
    };
}

async function handlePlotCommand(input) {
    if (LEGACY_2D_ANIMATION_PREFIX_RE.test(String(input || ''))) {
        return legacy2dAnimationError();
    }

    const rawParsed = parseCommandSyntax(input);
    const parsed = normalizeAndValidate(rawParsed, 'plot');
    if (!parsed.success) {
        return { success: false, error: parsed.errors.join('\n') };
    }

    const expr = parsed.body;
    if (!expr) {
        return { success: false, error: 'No expression provided for plotting.' };
    }

    const view = parsed.options.view || '2d';

    if (view === '3d') {
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
            isFlux: true,
            xlim: parsed.options.xlim,
            ylim: parsed.options.ylim,
            zlim: parsed.options.zlim
        };

        return await renderer.renderPlot3d(expr, opts);
    }

    // view: 2d
    if (parsed.options.animate) {
        return unsupported2dAnimationError();
    }

    const isAnimated = !!parsed.options.animate;
    const animationVar = parsed.options.animate || null;
    const labeledDomains = {};
    for (const r of parsed.ranges) {
        labeledDomains[r.name] = [r.min, r.max];
    }

    const opts = {
        isAnimated,
        animationVar,
        labeledDomains,
        kind: parsed.options.kind || undefined,
        variables: parsed.variables.map((entry) => entry.name),
        xlim: parsed.options.xlim,
        ylim: parsed.options.ylim
    };

    return await renderer.renderPlot(expr, opts);
}

module.exports = handlePlotCommand;
