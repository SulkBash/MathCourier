const math = require('../math');
const path = require('path');
const { parseCommandSyntax, normalizeAndValidate } = require('../parser');
const { extractInlineDependencies } = require('../inline-calculus');
const { runSubprocess } = require('./subprocess');
const { splitTopLevel, preprocessCalculusHelpers } = require('../utils');

const EQUATION_SOLVER_PATH = path.join(__dirname, '../../python/', 'equation_solver.py');
const EXPRESSION_MODES = new Set(['simplify', 'factor', 'expand']);
const IGNORED_SYMBOLS = new Set(['pi', 'e', 'i', 'true', 'false', 'NaN', 'null', 'Infinity']);
const MATRIX_FUNCTION_RE = /\b(?:det|inv|inverse|eigen|eig|eigs|rref)\s*\(/i;

function collectPlainVariables(source) {
    try {
        const parsed = math.parse(source);
        return extractVariables(parsed);
    } catch (_) {
        return [];
    }
}

function buildInlineArgDescriptors(args = []) {
    return args.map((arg) => ({
        kind: (arg && typeof arg.value === 'string') ? 'string' : 'expr',
        source: String((arg && typeof arg.value === 'string') ? arg.value : arg.toString())
    }));
}

function extractVariables(node) {
    const vars = new Set();

    function traverse(n, parent) {
        if (!n) return;

        if (n.isFunctionNode && n.fn && n.fn.isSymbolNode) {
            const helperName = n.fn.name;
            if (helperName === 'deriv' || helperName === 'integ') {
                const helperDeps = extractInlineDependencies(
                    helperName,
                    buildInlineArgDescriptors(n.args),
                    collectPlainVariables
                );
                helperDeps.forEach((name) => {
                    if (!IGNORED_SYMBOLS.has(name) && !math[name]) {
                        vars.add(name);
                    }
                });
                return;
            }
        }

        if (n.isSymbolNode) {
            if (parent && parent.isFunctionNode && parent.fn === n) {
                return;
            }

            const name = n.name;
            if (!IGNORED_SYMBOLS.has(name) && !math[name]) {
                vars.add(name);
            }
        }

        n.forEach((child) => traverse(child, n));
    }

    traverse(node, null);
    return Array.from(vars);
}

function formatVal(val) {
    if (val === null || isNaN(val)) return '\\text{NaN}';
    if (!isFinite(val)) return val > 0 ? '\\infty' : '-\\infty';
    if (Math.abs(val) < 1e-10) return '0';
    if (Math.abs(val) < 1e-3 || Math.abs(val) > 1e6) {
        const str = val.toExponential(4);
        const parts = str.split('e');
        const num = parts[0];
        const exp = parseInt(parts[1], 10);
        return `${num} \\times 10^{${exp}}`;
    }
    return Number(val.toFixed(6)).toString();
}

function findTopLevelRelation(text) {
    const source = String(text || '');
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let inQuotes = false;
    let quoteChar = null;

    for (let index = 0; index < source.length; index++) {
        const char = source[index];

        if (inQuotes) {
            if (char === '\\' && index + 1 < source.length) {
                index++;
                continue;
            }
            if (char === quoteChar) {
                inQuotes = false;
                quoteChar = null;
            }
            continue;
        }

        if (char === '"' || char === '\'') {
            inQuotes = true;
            quoteChar = char;
            continue;
        }

        if (char === '(') {
            parenDepth++;
            continue;
        }
        if (char === ')') {
            parenDepth = Math.max(0, parenDepth - 1);
            continue;
        }
        if (char === '[') {
            bracketDepth++;
            continue;
        }
        if (char === ']') {
            bracketDepth = Math.max(0, bracketDepth - 1);
            continue;
        }
        if (char === '{') {
            braceDepth++;
            continue;
        }
        if (char === '}') {
            braceDepth = Math.max(0, braceDepth - 1);
            continue;
        }

        if (parenDepth !== 0 || bracketDepth !== 0 || braceDepth !== 0) {
            continue;
        }

        const twoChar = source.slice(index, index + 2);
        if (twoChar === '<=' || twoChar === '>=') {
            return { index, operator: twoChar };
        }
        if (char === '=' || char === '<' || char === '>') {
            return { index, operator: char };
        }
    }

    return null;
}

function buildResidualSource(statementText) {
    const source = String(statementText || '').trim();
    const relation = findTopLevelRelation(source);

    if (!relation) {
        return {
            normalized: source,
            operator: null,
            lhsText: source,
            rhsText: null
        };
    }

    const lhsText = source.slice(0, relation.index).trim();
    const rhsText = source.slice(relation.index + relation.operator.length).trim();
    if (!lhsText || !rhsText) {
        throw new Error(`Equation "${source}" is missing one side of the relation operator.`);
    }

    return {
        normalized: `(${lhsText}) - (${rhsText})`,
        operator: relation.operator,
        lhsText,
        rhsText
    };
}

function formatEquationTex(statement) {
    try {
        if (statement.operator) {
            const lhsTex = math.parse(statement.lhsText).toTex();
            const rhsTex = math.parse(statement.rhsText).toTex();
            const relationTex = statement.operator === '<='
                ? '\\le'
                : statement.operator === '>='
                    ? '\\ge'
                    : statement.operator;
            return `${lhsTex} ${relationTex} ${rhsTex}`;
        }

        return `${math.parse(statement.str).toTex()} = 0`;
    } catch (_) {
        if (statement.operator) {
            return `${statement.lhsText} ${statement.operator} ${statement.rhsText}`;
        }
        return `${statement.str} = 0`;
    }
}

function splitStatements(body) {
    return splitTopLevel(String(body || ''), ';')
        .map((segment) => segment.trim())
        .filter(Boolean);
}

function parseStatementsForLocalSolver(statements) {
    const allVars = new Set();
    const parsedStatements = [];

    for (const statementText of statements) {
        const preprocessedText = preprocessCalculusHelpers(statementText);
        const residualInfo = buildResidualSource(preprocessedText);
        let node;
        try {
            node = math.parse(residualInfo.normalized);
        } catch (err) {
            throw new Error(`Parsing error in equation "${statementText}": ${err.message}`);
        }

        const eqVars = extractVariables(node);
        eqVars.forEach((name) => allVars.add(name));

        parsedStatements.push({
            ...residualInfo,
            node,
            str: statementText
        });
    }

    return {
        parsedStatements,
        variables: Array.from(allVars).sort()
    };
}

function hasInequalityStatements(statements) {
    return statements.some((statementText) => {
        const relation = findTopLevelRelation(statementText);
        return relation && relation.operator !== '=';
    });
}

function hasMatrixSyntaxStatements(statements) {
    return statements.some((statementText) => {
        const preprocessed = preprocessCalculusHelpers(String(statementText || ''));
        return MATRIX_FUNCTION_RE.test(preprocessed) || preprocessed.includes('[');
    });
}

function buildRangePayload(ranges) {
    const payload = {};
    for (const range of ranges || []) {
        payload[range.name] = [range.minExpr, range.maxExpr];
    }
    return payload;
}

function buildEquationPayload(statements, parsed, mode = null) {
    return {
        equations: statements,
        variables: (parsed.variables || []).map((entry) => entry.name),
        ranges: buildRangePayload(parsed.ranges),
        mode
    };
}

function runEquationSubprocess(payload) {
    return runSubprocess(EQUATION_SOLVER_PATH, payload);
}

function isExactishLatex(latex) {
    if (!latex || latex.includes('\\approx')) {
        return false;
    }

    return !/(^|[^\\])\d+\.\d+/.test(latex);
}

function shouldTrySymbolicUpgrade(localResult, statements, variables) {
    if (!localResult || !localResult.success) {
        return false;
    }
    if (statements.length !== 1 || variables.length !== 1) {
        return false;
    }

    return !isExactishLatex(localResult.latex);
}

function chooseError(primary, fallback) {
    if (!primary) {
        return fallback;
    }
    if (!fallback || !fallback.error) {
        return primary;
    }
    if (fallback.error === 'Internal solver error. The expression may be malformed or unsupported.') {
        return primary;
    }
    return fallback;
}

function solveEquationLocally(parsedStatements, variables) {
    const m = parsedStatements.length;
    const n = variables.length;

    if (n === 0) {
        try {
            const value = parsedStatements[0].node.evaluate();
            const isTautology = Math.abs(value) < 1e-10;
            return {
                success: true,
                latex: [
                    '\\begin{aligned}',
                    `${formatEquationTex(parsedStatements[0])} \\\\`,
                    isTautology
                        ? '\\implies \\text{Tautology (always true)}'
                        : '\\implies \\text{Contradiction (no solution)}',
                    '\\end{aligned}'
                ].join('\n')
            };
        } catch (err) {
            return { success: false, error: `Evaluation error: ${err.message}` };
        }
    }

    if (m > 1 || n > 1) {
        let isLinearSystem = true;
        const A = [];
        const b = [];

        for (let rowIndex = 0; rowIndex < m; rowIndex++) {
            const equationNode = parsedStatements[rowIndex].node;
            const rowCoefficients = [];

            for (let columnIndex = 0; columnIndex < n; columnIndex++) {
                const variableName = variables[columnIndex];
                try {
                    const derivative = math.derivative(equationNode, variableName);
                    const simplifiedDerivative = math.simplify(derivative);
                    const derivativeVars = extractVariables(simplifiedDerivative);
                    if (derivativeVars.length > 0) {
                        isLinearSystem = false;
                        break;
                    }

                    rowCoefficients.push(math.evaluate(simplifiedDerivative.toString()));
                } catch (_) {
                    isLinearSystem = false;
                    break;
                }
            }

            if (!isLinearSystem) {
                break;
            }

            const zeroScope = {};
            variables.forEach((name) => {
                zeroScope[name] = 0;
            });

            try {
                const constantTerm = equationNode.evaluate(zeroScope);
                A.push(rowCoefficients);
                b.push(-constantTerm);
            } catch (_) {
                isLinearSystem = false;
                break;
            }
        }

        if (!isLinearSystem) {
            return {
                success: false,
                error: 'Non-linear systems of equations are not supported locally.'
            };
        }

        if (m !== n) {
            return {
                success: false,
                error: `Linear system is not square: ${m} equations but ${n} variables (${variables.join(', ')}). A unique solution requires exactly as many equations as variables.`
            };
        }

        try {
            const solution = math.lusolve(A, b);
            const formattedSolutions = [];

            for (let index = 0; index < n; index++) {
                const value = solution[index][0];
                let formattedValue;
                if (typeof value === 'number') {
                    formattedValue = Number(value.toFixed(8)).toString();
                } else if (value && value.isComplex) {
                    const re = Number(value.re.toFixed(8)).toString();
                    const im = Number(value.im.toFixed(8)).toString();
                    if (Math.abs(value.im) < 1e-10) {
                        formattedValue = re;
                    } else {
                        const sign = value.im >= 0 ? '+' : '-';
                        const imAbs = Math.abs(value.im);
                        const imStr = imAbs === 1 ? 'i' : `${Number(imAbs.toFixed(8)).toString()}i`;
                        formattedValue = `${re} ${sign} ${imStr}`;
                    }
                } else {
                    formattedValue = math.format(value, { precision: 8 });
                }

                formattedSolutions.push(`${variables[index]} = ${formattedValue}`);
            }

            return {
                success: true,
                latex: [
                    '\\begin{aligned}',
                    '\\begin{cases}',
                    parsedStatements.map((statement) => formatEquationTex(statement)).join(' \\\\\n'),
                    '\\end{cases} \\\\',
                    `\\implies ${formattedSolutions.join(', \\quad ')}`,
                    '\\end{aligned}'
                ].join('\n')
            };
        } catch (err) {
            return { success: false, error: `Could not solve linear system: ${err.message}` };
        }
    }

    const variableName = variables[0];
    const equationNode = parsedStatements[0].node;
    const equationTex = formatEquationTex(parsedStatements[0]);

    let isLinear = false;
    let linearCoeff = null;
    let constantTerm = null;
    try {
        const derivative = math.derivative(equationNode, variableName);
        const simplifiedDerivative = math.simplify(derivative);
        const derivativeVars = extractVariables(simplifiedDerivative);
        if (derivativeVars.length === 0) {
            isLinear = true;
            linearCoeff = math.evaluate(simplifiedDerivative.toString());
            constantTerm = equationNode.evaluate({ [variableName]: 0 });
        }
    } catch (_) {
        isLinear = false;
    }

    if (isLinear && linearCoeff !== 0) {
        const root = -constantTerm / linearCoeff;
        return {
            success: true,
            latex: [
                '\\begin{aligned}',
                `${equationTex} \\\\`,
                `\\implies ${variableName} = ${Number(root.toFixed(8)).toString()}`,
                '\\end{aligned}'
            ].join('\n')
        };
    }

    let polynomialRoots = null;
    try {
        const rationalized = math.rationalize(equationNode, {}, true);
        if (
            rationalized.variables.length === 1 &&
            rationalized.variables[0] === variableName &&
            (rationalized.denominator === null || rationalized.denominator === undefined)
        ) {
            const degree = rationalized.coefficients.length - 1;
            if (degree >= 1 && degree <= 3) {
                polynomialRoots = math.polynomialRoot(...rationalized.coefficients);
            }
        }
    } catch (_) {
        polynomialRoots = null;
    }

    if (polynomialRoots) {
        const roots = polynomialRoots.map((root, index) => {
            if (typeof root === 'number') {
                return `${variableName}_${index + 1} = ${Number(root.toFixed(8)).toString()}`;
            }
            if (root && root.isComplex) {
                const re = Number(root.re.toFixed(8)).toString();
                const im = Number(root.im.toFixed(8)).toString();
                if (Math.abs(root.im) < 1e-10) {
                    return `${variableName}_${index + 1} = ${re}`;
                }
                const sign = root.im >= 0 ? '+' : '-';
                const imAbs = Math.abs(root.im);
                const imStr = imAbs === 1 ? 'i' : `${Number(imAbs.toFixed(8)).toString()}i`;
                return `${variableName}_${index + 1} = ${re} ${sign} ${imStr}`;
            }
            return `${variableName}_${index + 1} = ${math.format(root, { precision: 8 })}`;
        });

        return {
            success: true,
            latex: [
                '\\begin{aligned}',
                `${equationTex} \\\\`,
                `\\implies ${roots.join(', \\quad ')}`,
                '\\end{aligned}'
            ].join('\n')
        };
    }

    const compiledF = equationNode.compile();
    const f = (xVal) => {
        try {
            const result = compiledF.evaluate({ [variableName]: xVal });
            if (result && typeof result === 'object') {
                if (result.isComplex) return Math.abs(result.im) < 1e-10 ? result.re : NaN;
                return result.toNumber ? result.toNumber() : NaN;
            }
            return typeof result === 'number' ? result : NaN;
        } catch (_) {
            return NaN;
        }
    };

    let compiledDf = null;
    let hasCalculusHelper = false;
    equationNode.traverse((node) => {
        if (node && node.isFunctionNode && node.fn && node.fn.isSymbolNode) {
            if (node.fn.name === 'deriv' || node.fn.name === 'integ') {
                hasCalculusHelper = true;
            }
        }
    });

    if (!hasCalculusHelper) {
        try {
            compiledDf = math.derivative(equationNode, variableName).compile();
        } catch (_) {
            compiledDf = null;
        }
    }

    const df = (xVal) => {
        if (compiledDf) {
            try {
                const result = compiledDf.evaluate({ [variableName]: xVal });
                let value = NaN;
                if (result && typeof result === 'object') {
                    if (result.isComplex) {
                        value = Math.abs(result.im) < 1e-10 ? result.re : NaN;
                    } else {
                        value = result.toNumber ? result.toNumber() : NaN;
                    }
                } else {
                    value = typeof result === 'number' ? result : NaN;
                }

                if (!isNaN(value) && isFinite(value)) {
                    return value;
                }
            } catch (_) {
                // Fall back to finite differences.
            }
        }

        const h = 1e-7;
        const fPlus = f(xVal + h);
        const fMinus = f(xVal - h);
        if (!isNaN(fPlus) && !isNaN(fMinus)) {
            return (fPlus - fMinus) / (2 * h);
        }
        return NaN;
    };

    const candidates = [0, 1, -1, 0.5, -0.5, 2, -2, 5, -5, 10, -10];
    let rootVal = null;

    for (const x0 of candidates) {
        let x = x0;
        let converged = false;

        for (let step = 0; step <= 30; step++) {
            const y = f(x);
            const dy = df(x);

            if (isNaN(y) || isNaN(dy) || !isFinite(y) || !isFinite(dy)) {
                break;
            }

            if (Math.abs(y) < 1e-10) {
                converged = true;
                rootVal = x;
                break;
            }

            if (Math.abs(dy) < 1e-12) {
                break;
            }

            const nextX = x - y / dy;
            if (Math.abs(nextX - x) < 1e-12) {
                converged = true;
                rootVal = nextX;
                break;
            }

            x = nextX;
        }

        if (converged) {
            break;
        }
    }

    if (rootVal !== null) {
        return {
            success: true,
            latex: [
                '\\begin{aligned}',
                `${equationTex} \\\\`,
                `\\implies ${variableName} \\approx ${Number(rootVal.toFixed(10)).toString()}`,
                '\\end{aligned}'
            ].join('\n')
        };
    }

    return {
        success: false,
        error: 'Numerical solver could not converge to a root. Please verify if the equation has real roots.'
    };
}

async function solveEquation(inputStr) {
    const rawParsed = parseCommandSyntax(inputStr);
    const parsed = normalizeAndValidate(rawParsed, 'solve');
    if (!parsed.success) {
        return { success: false, error: parsed.errors.join('\n') };
    }

    const body = (parsed.body || '').trim();
    if (!body) {
        return { success: false, error: 'No equation provided.' };
    }

    const statements = splitStatements(body);
    if (statements.length === 0) {
        return { success: false, error: 'No equation provided.' };
    }

    const mode = parsed.options.mode || null;
    const targetVariables = parsed.variables.map((entry) => entry.name);
    const hasInequality = hasInequalityStatements(statements);
    const hasMatrixSyntax = hasMatrixSyntaxStatements(statements);
    const shouldUsePythonDirectly =
        EXPRESSION_MODES.has(mode) ||
        hasInequality ||
        hasMatrixSyntax ||
        targetVariables.length > 0 ||
        parsed.ranges.length > 0;

    if (shouldUsePythonDirectly) {
        return runEquationSubprocess(buildEquationPayload(statements, parsed, mode));
    }

    let localMeta = null;
    let localParseError = null;
    try {
        localMeta = parseStatementsForLocalSolver(statements);
    } catch (err) {
        localParseError = { success: false, error: err.message };
    }

    if (!localMeta) {
        const symbolicFallback = await runEquationSubprocess(buildEquationPayload(statements, parsed, mode));
        if (symbolicFallback.success) {
            return symbolicFallback;
        }
        return chooseError(localParseError, symbolicFallback);
    }

    if (statements.length === 1 && localMeta.variables.length > 1) {
        const localVariableError = {
            success: false,
            error: `Multiple variables detected: ${localMeta.variables.join(', ')}. Please specify vars:<variable>.`
        };
        const symbolicFallback = await runEquationSubprocess(buildEquationPayload(statements, parsed, null));
        if (symbolicFallback.success) {
            return symbolicFallback;
        }
        return chooseError(localVariableError, symbolicFallback);
    }

    const localResult = solveEquationLocally(localMeta.parsedStatements, localMeta.variables);
    if (localResult.success) {
        if (shouldTrySymbolicUpgrade(localResult, statements, localMeta.variables)) {
            const symbolicResult = await runEquationSubprocess(buildEquationPayload(statements, parsed, null));
            if (symbolicResult.success) {
                return symbolicResult;
            }
        }

        return localResult;
    }

    const symbolicFallback = await runEquationSubprocess(buildEquationPayload(statements, parsed, null));
    if (symbolicFallback.success) {
        return symbolicFallback;
    }

    return chooseError(localResult, symbolicFallback);
}

module.exports = {
    solveEquation,
    extractVariables,
    formatVal
};
