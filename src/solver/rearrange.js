const path = require('path');
const { runSubprocess } = require('./subprocess');

async function rearrangeEquation(inputStr) {
    const remainder = inputStr.trim();
    const match = remainder.match(/^([\s\S]+?)\bfor\b([\s\S]+)$/i);
    if (!match) {
        return {
            success: false,
            error: 'Invalid format. Use: !desp <equation> for <variable>\nExample: !desp E = m * c^2 for c'
        };
    }

    const equation = match[1].trim();
    const variable = match[2].trim();

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
