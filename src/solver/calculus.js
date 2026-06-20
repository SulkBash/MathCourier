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

function findTopLevelToken(str, token) {
    const lower = str.toLowerCase();
    const target = token.toLowerCase();
    let depth = 0;

    for (let i = 0; i <= str.length - target.length; i++) {
        const char = str[i];
        if (char === '(' || char === '[' || char === '{') {
            depth++;
        } else if (char === ')' || char === ']' || char === '}') {
            depth--;
        }

        if (depth !== 0) continue;
        if (!lower.startsWith(target, i)) continue;

        const before = i === 0 ? ' ' : str[i - 1];
        const afterIndex = i + target.length;
        const after = afterIndex >= str.length ? ' ' : str[afterIndex];
        if (/\s/.test(before) && /\s/.test(after)) {
            return i;
        }
    }

    return -1;
}

function extractTrailingRanges(str) {
    const rangeTokens = [];
    let index = str.length - 1;

    while (index >= 0) {
        while (index >= 0 && /\s/.test(str[index])) {
            index--;
        }

        if (index < 0 || str[index] !== ']') {
            break;
        }

        const end = index;
        let depth = 0;
        let start = -1;

        while (index >= 0) {
            const char = str[index];
            if (char === ']') {
                depth++;
            } else if (char === '[') {
                depth--;
                if (depth === 0) {
                    start = index;
                    break;
                }
            }
            index--;
        }

        if (start === -1) {
            return { error: 'Malformed range syntax. Use ranges like [0, 2*pi].' };
        }

        rangeTokens.unshift(str.slice(start, end + 1));
        index = start - 1;
    }

    return {
        body: str.slice(0, index + 1).trim(),
        rangeTokens
    };
}

function parseRangeToken(rangeToken) {
    const trimmed = rangeToken.trim();
    if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
        return { error: `Invalid range "${rangeToken}". Use [min, max].` };
    }

    const inner = trimmed.slice(1, -1).trim();
    const parts = splitTopLevel(inner);
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        return { error: `Invalid range "${rangeToken}". Use [min, max].` };
    }

    return {
        lower: parts[0],
        upper: parts[1]
    };
}

function parseFieldIntegralInput(input) {
    const trimmed = input.trim();
    const match = /^(line|surface|volume)\b/i.exec(trimmed);
    if (!match) {
        return null;
    }

    const integralType = match[1].toLowerCase();
    const remainder = trimmed.slice(match[0].length).trim();
    const extracted = extractTrailingRanges(remainder);
    if (extracted.error) {
        return extracted;
    }

    const { body, rangeTokens } = extracted;
    const ranges = [];
    for (const token of rangeTokens) {
        const parsed = parseRangeToken(token);
        if (parsed.error) {
            return parsed;
        }
        ranges.push(parsed);
    }

    if (integralType === 'line') {
        if (ranges.length !== 1) {
            return { error: 'Line integrals require exactly one parameter range like [0, 2*pi].' };
        }

        const pathIndex = findTopLevelToken(body, 'path');
        if (pathIndex === -1) {
            return { error: 'Line integrals must use the form: line <field> path <parametrization> [range].' };
        }

        const field = body.slice(0, pathIndex).trim();
        const parametrization = body.slice(pathIndex + 'path'.length).trim();
        if (!field || !parametrization) {
            return { error: 'Line integrals require both a field and a path parametrization.' };
        }

        return {
            operation: 'line_int',
            field,
            parametrization,
            ranges
        };
    }

    if (integralType === 'surface') {
        if (ranges.length !== 2) {
            return { error: 'Surface integrals require two parameter ranges like [0, pi] [0, 2*pi].' };
        }

        const surfaceIndex = findTopLevelToken(body, 'surface');
        if (surfaceIndex === -1) {
            return { error: 'Surface integrals must use the form: surface <field> surface <parametrization> [uRange] [vRange].' };
        }

        const field = body.slice(0, surfaceIndex).trim();
        const parametrization = body.slice(surfaceIndex + 'surface'.length).trim();
        if (!field || !parametrization) {
            return { error: 'Surface integrals require both a field and a surface parametrization.' };
        }

        return {
            operation: 'surface_int',
            field,
            parametrization,
            ranges
        };
    }

    if (ranges.length !== 3) {
        return { error: 'Volume integrals require three ranges like [xMin, xMax] [yMin, yMax] [zMin, zMax].' };
    }

    if (!body) {
        return { error: 'Volume integrals require a scalar field expression.' };
    }

    return {
        operation: 'volume_int',
        expr: body,
        ranges
    };
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
    const fieldIntegral = parseFieldIntegralInput(inputStr);
    if (fieldIntegral) {
        if (fieldIntegral.error) {
            return Promise.resolve({ success: false, error: fieldIntegral.error });
        }

        return runCalculusSubprocess(fieldIntegral);
    }

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
    parseFieldIntegralInput,
    splitTopLevel
};
