const math = require('../math');
const path = require('path');
const { runSubprocess } = require('./subprocess');
const { parseCommandSyntax, normalizeAndValidate } = require('../parser');

async function solvePde(inputStr) {
    const rawParsed = parseCommandSyntax(inputStr);
    const parsed = normalizeAndValidate(rawParsed, 'pde');
    if (!parsed.success) {
        return { success: false, error: parsed.errors.join('\n') };
    }

    const body = parsed.body || '';
    const ic = parsed.options.ic || '';
    const bc = parsed.options.bc || '';

    // Join body, ic, and bc with semicolons for python pde_solver
    const combinedText = `${body}; ${ic}; ${bc}`;

    // Find ranges for space x and time t
    const xRange = parsed.ranges.find(r => r.name === 'x') || parsed.ranges.find(r => r.name !== 't') || parsed.ranges[0];
    const tRange = parsed.ranges.find(r => r.name === 't') || parsed.ranges.find(r => r !== xRange) || parsed.ranges[1];

    const payload = {
        text: combinedText,
        x_min: xRange ? xRange.min : null,
        x_max: xRange ? xRange.max : null,
        t_min: tRange ? tRange.min : null,
        t_max: tRange ? tRange.max : null
    };

    const pyScriptPath = path.join(__dirname, '../../python/', 'pde_solver.py');
    const response = await runSubprocess(pyScriptPath, payload);
    
    if (!response.success) {
        return response;
    }

    // Attach domains
    if (xRange) {
        response.xDomain = [xRange.min, xRange.max];
    } else if (response.x && response.x.length > 0) {
        response.xDomain = [response.x[0], response.x[response.x.length - 1]];
    } else {
        response.xDomain = [0, 3.14159265];
    }

    if (tRange) {
        response.tDomain = [tRange.min, tRange.max];
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
