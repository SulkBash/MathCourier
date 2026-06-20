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
    input = input.trim();
    if (input.includes(',')) {
        const parts = splitTopLevel(input);
        if (parts.length >= 2) {
            let argIndex = parts.length;
            while (argIndex > 1) {
                const potentialArg = parts[argIndex - 1];
                if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(potentialArg) || /^\d+$/.test(potentialArg)) {
                    argIndex--;
                } else {
                    break;
                }
            }
            if (argIndex < parts.length) {
                const expr = parts.slice(0, argIndex).join(',');
                const args = parts.slice(argIndex).map(arg => /^\d+$/.test(arg) ? parseInt(arg, 10) : arg);
                return { expr, args };
            }
        }
    }

    // Space-separated fallback (e.g. "x^2 x" or "x^2 x 2")
    const tokens = input.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) {
        let argIndex = tokens.length;
        while (argIndex > 1) {
            const potentialArg = tokens[argIndex - 1];
            if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(potentialArg) || /^\d+$/.test(potentialArg)) {
                argIndex--;
            } else {
                break;
            }
        }
        if (argIndex < tokens.length) {
            const expr = tokens.slice(0, argIndex).join(' ');
            const args = tokens.slice(argIndex).map(arg => /^\d+$/.test(arg) ? parseInt(arg, 10) : arg);
            return { expr, args };
        }
    }

    return { expr: input, args: [] };
}

function parseIntegrationInput(input) {
    input = input.trim();
    if (input.includes(',')) {
        const parts = splitTopLevel(input);
        if (parts.length >= 2) {
            const expr = parts[0];
            const paramParts = parts.slice(1);
            const args = [];
            const nonVars = new Set(['pi', 'inf', 'infinity', 'e', 'i', 'nan']);
            
            const isVariable = (str) => {
                return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(str) && !nonVars.has(str.toLowerCase());
            };
            
            const isLimit = (str) => {
                if (/^-?\d+(\.\d+)?$/.test(str)) return true;
                if (/[\+\-\*\/\^\(\)\[\]]/.test(str)) return true;
                if (nonVars.has(str.toLowerCase())) return true;
                if (isVariable(str) && !expr.includes(str)) return true;
                return false;
            };

            let i = 0;
            while (i < paramParts.length) {
                const variable = paramParts[i];
                if (i + 2 < paramParts.length && isLimit(paramParts[i + 1])) {
                    args.push({
                        variable,
                        lower: paramParts[i + 1],
                        upper: paramParts[i + 2]
                    });
                    i += 3;
                } else {
                    args.push({ variable });
                    i += 1;
                }
            }
            return { expr, args };
        }
    }

    // Space-separated fallback
    const tokens = input.split(/\s+/).filter(Boolean);
    if (tokens.length >= 4) {
        const potentialVar = tokens[tokens.length - 3];
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(potentialVar)) {
            const upper = tokens[tokens.length - 1];
            const lower = tokens[tokens.length - 2];
            const variable = potentialVar;
            const expr = tokens.slice(0, tokens.length - 3).join(' ');
            return { expr, args: [{ variable, lower, upper }] };
        }
    }
    
    if (tokens.length >= 2) {
        const potentialVar = tokens[tokens.length - 1];
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(potentialVar)) {
            const variable = potentialVar;
            const expr = tokens.slice(0, tokens.length - 1).join(' ');
            return { expr, args: [{ variable }] };
        }
    }

    return { expr: input, args: [] };
}

function runCalculusSubprocess(payload) {
    const pyScriptPath = path.join(__dirname, '../../python/', 'calculus_solver.py');
    return runSubprocess(pyScriptPath, payload);
}

function solveDerivative(inputStr) {
    const parsed = parseDifferentiationInput(inputStr);
    let exprStr = parsed.expr;
    let args = parsed.args;

    if (!exprStr) {
        return Promise.resolve({ success: false, error: 'No expression provided for differentiation.' });
    }

    // If args is empty, extract variables
    if (args.length === 0) {
        try {
            const node = math.parse(exprStr);
            const vars = extractVariables(node);
            args = [vars.length === 1 ? vars[0] : 'x'];
        } catch (e) {
            args = ['x'];
        }
    }

    // Fast path with mathjs only if it's a single first-order derivative (e.g. ['x'])
    if (args.length === 1 && typeof args[0] === 'string') {
        const variable = args[0];
        try {
            const node = math.parse(exprStr);
            const derivativeNode = math.derivative(node, variable);
            const originalTex = node.toTex();
            const derivativeTex = derivativeNode.toTex();

            const latex = `\\begin{aligned}\n\\frac{d}{d${variable}}\\left(${originalTex}\\right) &= ${derivativeTex}\n\\end{aligned}`;
            return Promise.resolve({ success: true, latex });
        } catch (err) {
            console.log(`mathjs derivative failed, falling back to SymPy... Error: ${err.message}`);
        }
    }

    // Delegate to SymPy for multiple variables, higher-order derivatives, or mathjs fallback
    return runCalculusSubprocess({
        operation: 'diff',
        expr: exprStr,
        args: args
    });
}

function solveIntegral(inputStr) {
    const parsed = parseIntegrationInput(inputStr);
    let exprStr = parsed.expr;
    let args = parsed.args;

    if (!exprStr) {
        return Promise.resolve({ success: false, error: 'No expression provided for integration.' });
    }

    // If args is empty, extract variables
    if (args.length === 0) {
        try {
            const node = math.parse(exprStr);
            const vars = extractVariables(node);
            args = [{ variable: vars.length === 1 ? vars[0] : 'x' }];
        } catch (e) {
            args = [{ variable: 'x' }];
        }
    }

    return runCalculusSubprocess({
        operation: 'int',
        expr: exprStr,
        args: args
    });
}

module.exports = {
    solveDerivative,
    solveIntegral,
    parseDifferentiationInput,
    parseIntegrationInput,
    splitTopLevel
};
