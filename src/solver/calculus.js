const math = require('../math');
const path = require('path');
const { runSubprocess } = require('./subprocess');
const { extractVariables } = require('./equations');
const { parseCommandSyntax, normalizeAndValidate } = require('../parser');


function runCalculusSubprocess(payload) {
    const pyScriptPath = path.join(__dirname, '../../python/', 'calculus_solver.py');
    return runSubprocess(pyScriptPath, payload);
}

function inferDefaultVariable(exprStr, actionLabel, excludeVars = []) {
    try {
        const node = math.parse(exprStr);
        const vars = extractVariables(node).filter(v => !excludeVars.includes(v));

        if (vars.length === 0) {
            return { success: true, variable: 'x' };
        }

        if (vars.length === 1) {
            return { success: true, variable: vars[0] };
        }

        if (vars.includes('x')) {
            return { success: true, variable: 'x' };
        }

        return {
            success: false,
            error: `Could not infer a single variable for ${actionLabel}. Found multiple variables (${vars.join(', ')}). Use vars:<name> or vars:{...}.`
        };
    } catch (err) {
        return { success: true, variable: 'x' };
    }
}

function solveDerivative(inputStr) {
    const rawParsed = parseCommandSyntax(inputStr);
    const parsed = normalizeAndValidate(rawParsed, 'deriv');
    if (!parsed.success) {
        return Promise.resolve({ success: false, error: parsed.errors.join('\n') });
    }

    const exprStr = parsed.body;
    if (!exprStr) {
        return Promise.resolve({ success: false, error: 'No expression provided for differentiation.' });
    }

    // If 'dep' is present, we perform implicit differentiation
    if (parsed.options.dep && parsed.options.dep.length > 0) {
        let independentVar = 'x';
        let order = 1;
        if (parsed.variables.length > 0) {
            if (parsed.variables.length > 1) {
                return Promise.resolve({ success: false, error: 'Implicit differentiation only supports a single independent variable.' });
            }
            independentVar = parsed.variables[0].name;
            order = parsed.variables[0].order;
        } else {
            const inferred = inferDefaultVariable(exprStr, 'implicit differentiation', parsed.options.dep);
            if (!inferred.success) {
                return Promise.resolve({ success: false, error: inferred.error });
            }
            independentVar = inferred.variable;
        }

        return runCalculusSubprocess({
            operation: 'idiff',
            expr: exprStr,
            dep: parsed.options.dep,
            independentVar: independentVar,
            order: order
        });
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
        const inferred = inferDefaultVariable(exprStr, 'differentiation');
        if (!inferred.success) {
            return Promise.resolve({ success: false, error: inferred.error });
        }
        args = [inferred.variable];
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
    const parsed = normalizeAndValidate(rawParsed, 'integ');
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
        const inferred = inferDefaultVariable(exprStr, 'integration');
        if (!inferred.success) {
            return Promise.resolve({ success: false, error: inferred.error });
        }
        args = [{ variable: inferred.variable }];
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
