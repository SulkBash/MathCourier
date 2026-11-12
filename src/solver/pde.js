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

    const payload = {
        text: combinedText,
        named_ranges: Object.fromEntries(parsed.ranges.map((range) => [range.name, [range.min, range.max]]))
    };

    const pyScriptPath = path.join(__dirname, '../../python/', 'pde_solver.py');
    const response = await runSubprocess(pyScriptPath, payload);
    
    if (!response.success) {
        return response;
    }

    const xRange = parsed.ranges.find((range) => range.name === response.spatial_variable);
    const tRange = parsed.ranges.find((range) => range.name === response.temporal_variable);

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
