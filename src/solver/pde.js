const math = require('../math');
const path = require('path');
const { runSubprocess } = require('./subprocess');

async function solvePde(inputStr) {
    let remainder = inputStr.trim();

    // Parse space and time domains in brackets: [spaceRange] [timeRange]
    let xDomain = null;
    let tDomain = null;
    const rangeMatches = [...remainder.matchAll(/\[([^\]]+)\]/g)];
    
    if (rangeMatches.length > 0) {
        try {
            const parts = rangeMatches[0][1].split(',');
            const lo = math.evaluate(parts[0].trim());
            const hi = math.evaluate(parts[1].trim());
            if (!isNaN(lo) && !isNaN(hi) && isFinite(lo) && isFinite(hi) && lo < hi) {
                xDomain = [lo, hi];
            }
            remainder = remainder.replace(rangeMatches[0][0], '');
        } catch (e) {
            console.warn('Failed to parse space domain:', e.message);
        }
    }
    
    if (rangeMatches.length > 1) {
        try {
            const parts = rangeMatches[1][1].split(',');
            const lo = math.evaluate(parts[0].trim());
            const hi = math.evaluate(parts[1].trim());
            if (!isNaN(lo) && !isNaN(hi) && isFinite(lo) && isFinite(hi) && lo < hi) {
                tDomain = [lo, hi];
            }
            remainder = remainder.replace(rangeMatches[1][0], '');
        } catch (e) {
            console.warn('Failed to parse time domain:', e.message);
        }
    }

    remainder = remainder.trim();

    const payload = {
        text: remainder,
        x_min: xDomain ? xDomain[0] : null,
        x_max: xDomain ? xDomain[1] : null,
        t_min: tDomain ? tDomain[0] : null,
        t_max: tDomain ? tDomain[1] : null
    };

    const pyScriptPath = path.join(__dirname, '../../python/', 'pde_solver.py');
    const response = await runSubprocess(pyScriptPath, payload);
    
    if (!response.success) {
        return response;
    }

    // Attach domains if they were parsed or resolved from python results
    if (xDomain) {
        response.xDomain = xDomain;
    } else if (response.x && response.x.length > 0) {
        response.xDomain = [response.x[0], response.x[response.x.length - 1]];
    } else {
        response.xDomain = [0, 3.14159265];
    }

    if (tDomain) {
        response.tDomain = tDomain;
    } else if (response.t && response.t.length > 0) {
        response.tDomain = [response.t[0], response.t[response.t.length - 1]];
    } else {
        response.tDomain = [0, 1.0];
    }

    return response;
}

module.exports = {
    solvePde
};
