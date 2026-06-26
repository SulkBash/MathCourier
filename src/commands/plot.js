const renderer = require('../renderer');
const { parseCommandSyntax, normalizeAndValidate } = require('../parser');

const UNSUPPORTED_INLINE_FLAG_RE = /^\s*-[A-Za-z](?:\[[A-Za-z][A-Za-z0-9_]*\]|[A-Za-z0-9_]*)\s+\S/;

function invalid2dAnimationPrefixError() {
    return {
        success: false,
        error: 'Invalid !plot animation syntax. Use animate:<param> with labeled ranges, for example `!plot y = sin(x) animate:x x:[-10, 10] y:[-2, 2]`.'
    };
}

async function handlePlotCommand(input) {
    if (UNSUPPORTED_INLINE_FLAG_RE.test(String(input || ''))) {
        return invalid2dAnimationPrefixError();
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
