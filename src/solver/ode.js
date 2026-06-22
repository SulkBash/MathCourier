const math = require('../math');
const path = require('path');
const { runSubprocess } = require('./subprocess');
const { parseCommandSyntax, normalizeAndValidate } = require('../parser');

async function solveOde(inputStr) {
    const rawParsed = parseCommandSyntax(inputStr);
    const parsed = normalizeAndValidate(rawParsed, 'ode');
    if (!parsed.success) {
        return { success: false, error: parsed.errors.join('\n') };
    }

    const body = parsed.body || '';
    const ic = parsed.options.ic || '';
    
    // Join body and ic with semicolons for python ode_solver
    const combinedText = `${body}; ${ic}`;
    const mode = parsed.options.mode || 'hybrid';

    // Find range for independent variable (defaults to t or x)
    const indRange = parsed.ranges.find(r => r.name === 't' || r.name === 'x') || parsed.ranges[0];
    const xMin = indRange ? indRange.min : null;
    const xMax = indRange ? indRange.max : null;

    const payload = {
        text: combinedText,
        mode: mode,
        x_min: xMin,
        x_max: xMax
    };

    if (parsed.options.phase) {
        const phaseAxes = parsed.options.phase.map(v => v.trim().toLowerCase());
        payload.plot_axes = phaseAxes;
    }

    const pyScriptPath = path.join(__dirname, '../../python/', 'ode_solver.py');
    const response = await runSubprocess(pyScriptPath, payload);
    if (!response.success) {
        return response;
    }

    // Attach domains to response
    const phaseAxes = payload.plot_axes;
    if (phaseAxes) {
        if (response.curves && Object.keys(response.curves).length > 0) {
            const firstCurve = Object.values(response.curves)[0];
            if (firstCurve && firstCurve.length > 0) {
                const xValues = firstCurve.map(pt => pt.x).filter(v => v !== null && !isNaN(v) && isFinite(v));
                if (xValues.length > 0) {
                    const minVal = Math.min(...xValues);
                    const maxVal = Math.max(...xValues);
                    const range = maxVal - minVal;
                    const pad = Math.max(range * 0.15, 1.0); // 15% padding
                    response.xDomain = [minVal - pad, maxVal + pad];
                }
            }
        }
        if (!response.xDomain) {
            response.xDomain = [-10, 10];
        }
    } else {
        if (indRange) {
            response.xDomain = [indRange.min, indRange.max];
        } else if (response.curves && Object.keys(response.curves).length > 0) {
            const firstCurve = Object.values(response.curves)[0];
            if (firstCurve && firstCurve.length > 0) {
                const tVals = firstCurve.map(pt => pt.x);
                response.xDomain = [Math.min(...tVals), Math.max(...tVals)];
            }
        }
    }

    // Find dependent variable range if any
    const depRange = parsed.ranges.find(r => r !== indRange);
    if (depRange) {
        response.yDomain = [depRange.min, depRange.max];
    }

    return response;
}

module.exports = {
    solveOde
};
