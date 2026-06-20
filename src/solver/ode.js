const math = require('../math');
const path = require('path');
const { runSubprocess } = require('./subprocess');

async function solveOde(inputStr) {
    let remainder = inputStr.trim();
    let mode = 'hybrid';

    // 1. Parse mode flags
    if (remainder.startsWith('-s ') || remainder.startsWith('--sym ')) {
        mode = 'sym';
        remainder = remainder.replace(/^(--sym|-s)\s+/, '');
    } else if (remainder.startsWith('-n ') || remainder.startsWith('--num ')) {
        mode = 'num';
        remainder = remainder.replace(/^(--num|-n)\s+/, '');
    }

    let phaseAxes = null;
    const phaseMatch = remainder.match(/^(-p|--phase)\s+([a-zA-Z]+),([a-zA-Z]+)\s+/);
    if (phaseMatch) {
        phaseAxes = [phaseMatch[2], phaseMatch[3]];
        remainder = remainder.replace(phaseMatch[0], '');
    }

    // 2. Parse X and Y domains in brackets
    let xDomain = null;
    let yDomain = null;
    const rangeMatches = [...remainder.matchAll(/\[([^\]]+)\]/g)];
    if (rangeMatches.length > 0) {
        try {
            const parts = rangeMatches[0][1].split(',');
            const lo = math.evaluate(parts[0].trim());
            const hi = math.evaluate(parts[1].trim());
            if (!isNaN(lo) && !isNaN(hi) && isFinite(lo) && isFinite(hi) && lo < hi) xDomain = [lo, hi];
            remainder = remainder.replace(rangeMatches[0][0], '');
        } catch (e) {}
    }
    if (rangeMatches.length > 1) {
        try {
            const parts = rangeMatches[1][1].split(',');
            const lo = math.evaluate(parts[0].trim());
            const hi = math.evaluate(parts[1].trim());
            if (!isNaN(lo) && !isNaN(hi) && isFinite(lo) && isFinite(hi) && lo < hi) yDomain = [lo, hi];
            remainder = remainder.replace(rangeMatches[1][0], '');
        } catch (e) {}
    }

    remainder = remainder.trim();

    const xMin = xDomain ? xDomain[0] : null;
    const xMax = xDomain ? xDomain[1] : null;

    const payload = {
        text: remainder,
        mode: mode,
        x_min: xMin,
        x_max: xMax
    };
    if (phaseAxes) {
        payload.plot_axes = phaseAxes;
    }

    const pyScriptPath = path.join(__dirname, '../../python/', 'ode_solver.py');
    const response = await runSubprocess(pyScriptPath, payload);
    if (!response.success) {
        return response;
    }

    // If domains were resolved, attach them to the response
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
        if (xDomain) {
            response.xDomain = xDomain;
        } else if (response.curves && Object.keys(response.curves).length > 0) {
            // Python calculates points in default range, extract min/max t from curves
            const firstCurve = Object.values(response.curves)[0];
            if (firstCurve && firstCurve.length > 0) {
                const tVals = firstCurve.map(pt => pt.x);
                response.xDomain = [Math.min(...tVals), Math.max(...tVals)];
            }
        }
    }

    if (yDomain) {
        response.yDomain = yDomain;
    }

    return response;
}

module.exports = {
    solveOde
};
