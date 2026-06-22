const math = require('../math');
const path = require('path');
const { runSubprocess } = require('./subprocess');
const { extractVariables } = require('./equations');
const { parseCommandSyntax, normalizeAndValidate } = require('../parser');


function runCalculusSubprocess(payload) {
    const pyScriptPath = path.join(__dirname, '../../python/', 'calculus_solver.py');
    return runSubprocess(pyScriptPath, payload);
}

function solveDerivative(inputStr) {
    const rawParsed = parseCommandSyntax(inputStr);
    const parsed = normalizeAndValidate(rawParsed, 'diff');
    if (!parsed.success) {
        return Promise.resolve({ success: false, error: parsed.errors.join('\n') });
    }

    const exprStr = parsed.body;
    if (!exprStr) {
        return Promise.resolve({ success: false, error: 'No expression provided for differentiation.' });
    }

    let args = [];
    if (parsed.variables.length > 0) {
        for (const v of parsed.variables) {
            args.push(v.name);
            if (v.order > 1) {
                args.push(v.order);
            }
        }
    } else {
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
    const rawParsed = parseCommandSyntax(inputStr);
    const parsed = normalizeAndValidate(rawParsed, 'int');
    if (!parsed.success) {
        return Promise.resolve({ success: false, error: parsed.errors.join('\n') });
    }

    const exprStr = parsed.body;
    if (!exprStr) {
        return Promise.resolve({ success: false, error: 'No expression provided for integration.' });
    }

    const kind = parsed.options.kind;

    if (kind === 'line') {
        if (!parsed.options.hasOwnProperty('param')) {
            return Promise.resolve({ success: false, error: 'Line integrals require a path parametrization: param:{...}.' });
        }
        if (parsed.ranges.length !== 1) {
            return Promise.resolve({ success: false, error: 'Line integrals require exactly one parameter range like t:[0, 2*pi].' });
        }

        return runCalculusSubprocess({
            operation: 'line_int',
            field: exprStr,
            parametrization: `(${parsed.options.param})`,
            ranges: parsed.ranges.map(r => ({ label: r.name, lower: r.minExpr, upper: r.maxExpr }))
        });
    }

    if (kind === 'surface') {
        if (!parsed.options.hasOwnProperty('param')) {
            return Promise.resolve({ success: false, error: 'Surface integrals require a surface parametrization: param:{...}.' });
        }
        if (parsed.ranges.length !== 2) {
            return Promise.resolve({ success: false, error: 'Surface integrals require exactly two parameter ranges like u:[0, pi] v:[0, 2*pi].' });
        }

        return runCalculusSubprocess({
            operation: 'surface_int',
            field: exprStr,
            parametrization: `(${parsed.options.param})`,
            ranges: parsed.ranges.map(r => ({ label: r.name, lower: r.minExpr, upper: r.maxExpr }))
        });
    }

    if (kind === 'volume') {
        if (parsed.ranges.length !== 3) {
            return Promise.resolve({ success: false, error: 'Volume integrals require exactly three ranges like x:[0, 1] y:[0, 2] z:[0, 3].' });
        }

        return runCalculusSubprocess({
            operation: 'volume_int',
            expr: exprStr,
            ranges: parsed.ranges.map(r => ({ label: r.name, lower: r.minExpr, upper: r.maxExpr }))
        });
    }

    // Standard symbolic integral
    let args = [];
    if (parsed.ranges.length > 0) {
        args = parsed.ranges.map(r => ({
            variable: r.name,
            lower: r.minExpr,
            upper: r.maxExpr
        }));
    } else if (parsed.variables.length > 0) {
        args = parsed.variables.map(v => ({
            variable: v.name
        }));
    } else {
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
    solveIntegral
};
