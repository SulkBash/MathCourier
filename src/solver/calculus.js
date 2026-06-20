const math = require('../math');
const path = require('path');
const { runSubprocess } = require('./subprocess');
const { extractVariables } = require('./equations');

function splitTopLevel(str) {
    const parts = [];
    let current = '';
    let depth = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (char === '(' || char === '[' || char === '{') {
            depth++;
            current += char;
        } else if (char === ')' || char === ']' || char === '}') {
            depth--;
            current += char;
        } else if (char === ',' && depth === 0) {
            parts.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    parts.push(current.trim());
    return parts.filter(Boolean);
}

function parseDifferentiationInput(input) {
    let expr = '';
    let variable = '';

    input = input.trim();

    // Check comma separation
    if (input.includes(',')) {
        const parts = splitTopLevel(input);
        if (parts.length >= 2) {
            const potentialVar = parts[parts.length - 1];
            if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(potentialVar)) {
                variable = potentialVar;
                expr = parts.slice(0, parts.length - 1).join(',');
                return { expr, variable };
            }
        }
    }

    // Space-separated
    const tokens = input.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) {
        const potentialVar = tokens[tokens.length - 1];
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(potentialVar)) {
            variable = potentialVar;
            expr = tokens.slice(0, tokens.length - 1).join(' ');
            return { expr, variable };
        }
    }

    expr = input;
    return { expr, variable };
}

function parseIntegrationInput(input) {
    let expr = '';
    let variable = '';
    let lower = null;
    let upper = null;

    input = input.trim();

    // Check comma separation first
    if (input.includes(',')) {
        const parts = splitTopLevel(input);
        if (parts.length >= 4) {
            upper = parts[parts.length - 1];
            lower = parts[parts.length - 2];
            variable = parts[parts.length - 3];
            expr = parts.slice(0, parts.length - 3).join(',');
            return { expr, variable, lower, upper };
        } else if (parts.length === 2) {
            expr = parts[0];
            variable = parts[1];
            return { expr, variable, lower, upper };
        }
    }

    // Space-separated fallback
    const tokens = input.split(/\s+/).filter(Boolean);
    if (tokens.length >= 4) {
        const potentialVar = tokens[tokens.length - 3];
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(potentialVar)) {
            upper = tokens[tokens.length - 1];
            lower = tokens[tokens.length - 2];
            variable = potentialVar;
            expr = tokens.slice(0, tokens.length - 3).join(' ');
            return { expr, variable, lower, upper };
        }
    }
    
    if (tokens.length >= 2) {
        const potentialVar = tokens[tokens.length - 1];
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(potentialVar)) {
            variable = potentialVar;
            expr = tokens.slice(0, tokens.length - 1).join(' ');
            return { expr, variable, lower, upper };
        }
    }

    expr = input;
    return { expr, variable, lower, upper };
}

function runCalculusSubprocess(payload) {
    const pyScriptPath = path.join(__dirname, '../../python/', 'calculus_solver.py');
    return runSubprocess(pyScriptPath, payload);
}

function solveDerivative(inputStr) {
    const parsed = parseDifferentiationInput(inputStr);
    let exprStr = parsed.expr;
    let varStr = parsed.variable;

    if (!exprStr) {
        return Promise.resolve({ success: false, error: 'No expression provided for differentiation.' });
    }

    try {
        const node = math.parse(exprStr);
        let actualVarStr = varStr;
        if (!actualVarStr) {
            const vars = extractVariables(node);
            actualVarStr = vars.length === 1 ? vars[0] : 'x';
        }

        const derivativeNode = math.derivative(node, actualVarStr);
        const originalTex = node.toTex();
        const derivativeTex = derivativeNode.toTex();

        const latex = `\\begin{aligned}\n\\frac{d}{d${actualVarStr}}\\left(${originalTex}\\right) &= ${derivativeTex}\n\\end{aligned}`;
        return Promise.resolve({ success: true, latex });
    } catch (err) {
        console.log(`mathjs derivative failed, falling back to SymPy... Error: ${err.message}`);
        return runCalculusSubprocess({
            operation: 'diff',
            expr: exprStr,
            variable: varStr
        });
    }
}

function solveIntegral(inputStr) {
    const parsed = parseIntegrationInput(inputStr);
    let exprStr = parsed.expr;
    let varStr = parsed.variable;
    let lower = parsed.lower;
    let upper = parsed.upper;

    if (!exprStr) {
        return Promise.resolve({ success: false, error: 'No expression provided for integration.' });
    }

    return runCalculusSubprocess({
        operation: 'int',
        expr: exprStr,
        variable: varStr,
        lower: lower,
        upper: upper
    });
}

module.exports = {
    solveDerivative,
    solveIntegral,
    parseDifferentiationInput,
    parseIntegrationInput,
    splitTopLevel
};
