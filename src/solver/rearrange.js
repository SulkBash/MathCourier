const path = require('path');
const { runSubprocess } = require('./subprocess');
const { parseCommandSyntax, normalizeAndValidate } = require('../parser');

async function rearrangeEquation(inputStr) {
    let equation = '';
    let variable = '';

    // First try V2 parser
    const rawParsed = parseCommandSyntax(inputStr);
    const parsed = normalizeAndValidate(rawParsed, 'desp');
    if (parsed.success && parsed.variables.length === 1) {
        equation = parsed.body;
        variable = parsed.variables[0].name;
    } else {
        // Fallback to legacy syntax
        const match = inputStr.trim().match(/^([\s\S]+?)\bfor\b([\s\S]+)$/i);
        if (!match) {
            return {
                success: false,
                error: 'Invalid format. Use: !desp <equation> vars:c  or  !desp <equation> for c'
            };
        }
        equation = match[1].trim();
        variable = match[2].trim();
    }

    if (!equation) {
        return { success: false, error: 'No equation provided.' };
    }
    if (!variable) {
        return { success: false, error: 'No target variable provided.' };
    }

    // Validate variable name to prevent command/LaTeX injection
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(variable)) {
        return { success: false, error: 'Invalid variable name. It must be a simple alphanumeric name.' };
    }

    const payload = {
        equation: equation,
        variable: variable
    };

    const pyScriptPath = path.join(__dirname, '../../python/', 'rearrange_solver.py');
    return await runSubprocess(pyScriptPath, payload);
}

module.exports = {
    rearrangeEquation
};
