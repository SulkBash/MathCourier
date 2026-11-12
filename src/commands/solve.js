const math = require('../math');
const renderer = require('../renderer');
const solver = require('../solver');
const { parseVectorHelperCall } = require('../inline-calculus');
const { parseCommandSyntax, normalizeAndValidate, validateRouteOptions } = require('../parser');
const { preprocessCalculusHelpers, splitTopLevel, isReservedMathSymbol } = require('../utils');
const { expandScientificPlot } = require('../solver/scientific');
const handleOdeCommand = require('./ode');
const handlePdeCommand = require('./pde');

const HELPER_BRACKET_NAMES = new Set([
    'deriv',
    'integ',
    'grad',
    'gradx',
    'grady',
    'gradz',
    'lap',
    'div',
    'curl',
    'curlx',
    'curly',
    'curlz',
    'limit', 'series', 'laplace', 'invlaplace', 'fourier', 'invfourier', 'convert', 'dimension'
]);

const MATRIX_FUNCTION_RE = /\b(?:det|inv|inverse|eigen|eig|eigs|rref)\s*\(/i;
const ODE_PATTERN_RE = /(?:\bdy\/dx\b|\bd2y\/dx2\b|\b[a-zA-Z_][a-zA-Z0-9_]*'{1,2}\b|\bd\d*[a-zA-Z_][a-zA-Z0-9_]*\/d[a-zA-Z_][a-zA-Z0-9_]*(?:\d+)?\b)/i;
const PDE_PATTERN_RE = /(?:\bdu\/dt\b|\bd2u\/dx2\b|\bu_t\b|\bu_xx\b)/i;
const REMOVED_SOLVE_MODE_RE = /^(diff|int|grad|lap|div|curl|matrix|ode|pde)$/i;
const REMOVED_SOLVE_PREFIX_RE = /^(diff|int|grad|lap|div|curl|matrix|ode|pde)\s+([\s\S]+)$/i;
const TOP_LEVEL_VECTOR_HELPERS = new Set(['grad', 'lap', 'div', 'curl']);
const SCIENTIFIC_HELPERS = new Set(['limit', 'series', 'laplace', 'invlaplace', 'fourier', 'invfourier', 'convert', 'dimension']);
const HAS_SCIENTIFIC_HELPER = /(?<![A-Za-z_])(?:limit|series|laplace|invlaplace|fourier|invfourier|convert|dimension)\s*\[/i;

function getMode(parsed) {
    if (!parsed || !parsed.options || !parsed.options.mode) {
        return null;
    }

    return String(parsed.options.mode).toLowerCase().trim();
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

function hasTopLevelRelation(text) {
    return Boolean(findTopLevelRelation(text));
}

function hasStandaloneSquareBracket(text) {
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
        if (char === '{') {
            braceDepth++;
            continue;
        }
        if (char === '}') {
            braceDepth = Math.max(0, braceDepth - 1);
            continue;
        }

        if (char === '[') {
            let cursor = index - 1;
            while (cursor >= 0 && /\s/.test(source[cursor])) {
                cursor--;
            }

            let identifierEnd = cursor;
            while (cursor >= 0 && /[a-zA-Z0-9_]/.test(source[cursor])) {
                cursor--;
            }

            const identifier = source.slice(cursor + 1, identifierEnd + 1).toLowerCase();
            if (!HELPER_BRACKET_NAMES.has(identifier)) {
                return true;
            }

            bracketDepth++;
            continue;
        }

        if (char === ']') {
            bracketDepth = Math.max(0, bracketDepth - 1);
            continue;
        }

        if (parenDepth !== 0 || bracketDepth !== 0 || braceDepth !== 0) {
            continue;
        }
    }

    return false;
}

function looksLikeMatrix(body) {
    const source = String(body || '').trim();
    if (!source) {
        return false;
    }

    const preprocessed = preprocessCalculusHelpers(source);
    return MATRIX_FUNCTION_RE.test(preprocessed) || hasStandaloneSquareBracket(preprocessed);
}

function looksAmbiguousSolveTuple(body) {
    const source = String(body || '').trim();
    if (!source.startsWith('(') || !source.endsWith(')')) {
        return false;
    }

    let depth = 0;
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
            depth++;
            continue;
        }
        if (char === ')') {
            depth = Math.max(0, depth - 1);
            if (depth === 0 && index !== source.length - 1) {
                return false;
            }
            continue;
        }
    }

    if (depth !== 0) {
        return false;
    }

    const parts = splitTopLevel(source.slice(1, -1), ',')
        .map((part) => part.trim())
        .filter(Boolean);

    return parts.length >= 2 && parts.length <= 3;
}

function looksLikePde(body, options = {}) {
    const source = String(body || '').trim();
    if (!source || !hasTopLevelRelation(source)) {
        return false;
    }

    if (Object.prototype.hasOwnProperty.call(options, 'bc')) {
        return true;
    }

    return PDE_PATTERN_RE.test(source);
}

function looksLikeOde(body, options = {}) {
    const source = String(body || '').trim();
    if (!source || !hasTopLevelRelation(source)) {
        return false;
    }

    if (looksLikePde(source, options)) {
        return false;
    }

    if (
        Object.prototype.hasOwnProperty.call(options, 'phase') ||
        Object.prototype.hasOwnProperty.call(options, 'ic')
    ) {
        return true;
    }

    return ODE_PATTERN_RE.test(source);
}

function parseTopLevelBracketHelper(body, allowedNames = HELPER_BRACKET_NAMES) {
    const source = String(body || '').trim();
    if (!source) {
        return null;
    }

    const match = source.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\[/);
    if (!match) {
        return null;
    }

    const helperName = match[1].toLowerCase();
    if (!allowedNames.has(helperName)) {
        return null;
    }

    const openIndex = source.indexOf('[', match[0].length - 1);
    if (openIndex === -1) {
        return null;
    }

    let depth = 1;
    let parenDepth = 0;
    let braceDepth = 0;
    let inQuotes = false;
    let quoteChar = null;
    let index = openIndex + 1;

    while (index < source.length && depth > 0) {
        const char = source[index];

        if (inQuotes) {
            if (char === '\\' && index + 1 < source.length) {
                index += 2;
                continue;
            }
            if (char === quoteChar) {
                inQuotes = false;
                quoteChar = null;
            }
            index++;
            continue;
        }

        if (char === '"' || char === '\'') {
            inQuotes = true;
            quoteChar = char;
            index++;
            continue;
        }

        if (char === '(') {
            parenDepth++;
            index++;
            continue;
        }
        if (char === ')') {
            parenDepth = Math.max(0, parenDepth - 1);
            index++;
            continue;
        }
        if (char === '{') {
            braceDepth++;
            index++;
            continue;
        }
        if (char === '}') {
            braceDepth = Math.max(0, braceDepth - 1);
            index++;
            continue;
        }
        if (char === '[' && parenDepth === 0 && braceDepth === 0) {
            depth++;
            index++;
            continue;
        }
        if (char === ']' && parenDepth === 0 && braceDepth === 0) {
            depth--;
            index++;
            continue;
        }

        index++;
    }

    if (depth !== 0) {
        return null;
    }

    const trailing = source.slice(index).trim();
    if (trailing) {
        return null;
    }

    return {
        name: helperName,
        inner: source.slice(openIndex + 1, index - 1).trim()
    };
}

function extractVarsFromSource(source) {
    try {
        const vars = new Set();
        math.parse(String(source || '')).traverse((node, path, parent) => {
            if (!node || !node.isSymbolNode) {
                return;
            }

            if (parent && parent.isFunctionNode && parent.fn === node) {
                return;
            }

            const name = node.name;
            if (!name || isReservedMathSymbol(math, name)) {
                return;
            }

            vars.add(name);
        });
        return Array.from(vars);
    } catch (_) {
        return [];
    }
}

function buildVectorHelperInput(helperName, helperBody) {
    const args = splitTopLevel(String(helperBody || ''), ',')
        .map((part) => part.trim())
        .filter(Boolean);

    if (args.length === 0) {
        return {
            success: false,
            error: `${helperName} requires an expression.`
        };
    }

    const parsed = parseVectorHelperCall(
        helperName,
        args.map((source, index) => ({
            kind: index === 0 ? 'expr' : 'string',
            source
        })),
        extractVarsFromSource
    );
    if (!parsed.success) {
        return parsed;
    }

    return {
        success: true,
        input: parsed.varNames.length > 0
            ? `${parsed.exprSource} vars:{${parsed.varNames.join(', ')}}`
            : parsed.exprSource
    };
}

function rebuildInput(parsed, extraOptions = []) {
    return rebuildInputWithBody(parsed, parsed && parsed.body ? parsed.body : '', extraOptions);
}

function rebuildInputWithBody(parsed, body, extraOptions = []) {
    const parts = [];

    if (body) {
        parts.push(body);
    }

    const rawOptions = parsed && parsed.rawOptions ? parsed.rawOptions : {};
    for (const [key, rawToken] of Object.entries(rawOptions)) {
        if (key === 'mode') {
            continue;
        }
        parts.push(rawToken);
    }

    parts.push(...extraOptions.filter(Boolean));
    return parts.filter(Boolean).join(' ').trim();
}

function withSolveMode(parsed, mode) {
    return rebuildInput(parsed, [`mode:${mode}`]);
}

function appendHelperNotes(result, notes) {
    if (result.success && result.latex && notes && notes.length) {
        result.latex = result.latex.replace('\n\\end{aligned}', ' \\\\\n' + notes.join(' \\\\\n') + '\n\\end{aligned}');
    }
    return result;
}

async function renderSolverResult(solverFn, input) {
    const result = await Promise.resolve(solverFn(input));
    if (!result || !result.success) {
        return { success: false, error: result && result.error ? result.error : 'Solver failed.' };
    }

    if (result.data) {
        return result;
    }

    if (!result.latex) {
        return { success: false, error: 'Solver did not return LaTeX output.' };
    }

    return renderer.render(result.latex, true);
}

function buildRemovedSolveRouteGuidance(mode) {
    const normalized = String(mode || '').toLowerCase().trim();

    if (normalized === 'diff') {
        return 'Route "diff" has been removed. Use !solve deriv[expr, x] instead.';
    }
    if (normalized === 'int') {
        return 'Route "int" has been removed. Use !solve integ[expr, x] for antiderivatives or integ[expr, x:[a, b]] for definite integrals.';
    }
    if (normalized === 'grad' || normalized === 'lap' || normalized === 'div' || normalized === 'curl') {
        return `Route "${normalized}" has been removed. Use !solve ${normalized}[...] instead.`;
    }
    if (normalized === 'matrix') {
        return 'Route "matrix" has been removed. Send the matrix expression directly to !solve.';
    }
    if (normalized === 'ode' || normalized === 'pde') {
        return `Route "${normalized}" has been removed. Send the equation directly to !solve and let the router detect it.`;
    }

    return 'That solve route has been removed. Use the unified !solve syntax instead.';
}

async function handleSolveCommand(input) {
    const rawParsed = parseCommandSyntax(input);
    const rawBody = (rawParsed.body || '').trim();
    const rawMode = rawParsed && rawParsed.options && rawParsed.options.mode
        ? String(rawParsed.options.mode).toLowerCase().trim()
        : null;

    if (rawMode && REMOVED_SOLVE_MODE_RE.test(rawMode)) {
        return {
            success: false,
            error: buildRemovedSolveRouteGuidance(rawMode)
        };
    }

    const prefixedRemovedRoute = rawBody.match(REMOVED_SOLVE_PREFIX_RE);
    if (prefixedRemovedRoute) {
        return {
            success: false,
            error: buildRemovedSolveRouteGuidance(prefixedRemovedRoute[1])
        };
    }

    const parsed = normalizeAndValidate(rawParsed, 'solve');
    if (!parsed.success) {
        return { success: false, error: parsed.errors.join('\n') };
    }

    const body = (parsed.body || '').trim();
    if (!body) {
        return { success: false, error: 'Missing command body.' };
    }

    const mode = getMode(parsed);
    const hasRelation = hasTopLevelRelation(body);
    const bracketHelper = parseTopLevelBracketHelper(body, TOP_LEVEL_VECTOR_HELPERS);
    const scientificHelper = parseTopLevelBracketHelper(body, SCIENTIFIC_HELPERS);

    if (scientificHelper) {
        const allowed = new Set(['assume', 'dir', 'convention', 'mode']);
        const unsupported = Object.keys(parsed.rawOptions || {}).find((key) => !allowed.has(key));
        if (unsupported) {
            return { success: false, error: 'Option "' + unsupported + '" is not supported for this helper.' };
        }
        if (mode) {
            if (!['factor', 'expand', 'simplify'].includes(mode)) {
                return { success: false, error: `mode:${mode} is not supported for this helper.` };
            }
            if (['convert', 'dimension'].includes(scientificHelper.name)) {
                return { success: false, error: 'Expression modes are not supported for unit quantities or dimension metadata.' };
            }
            if (parsed.options.dir && scientificHelper.name !== 'limit') {
                return { success: false, error: 'Option "dir" only applies to limits.' };
            }
            if (parsed.options.convention && !['fourier', 'invfourier'].includes(scientificHelper.name)) {
                return { success: false, error: 'Option "convention" only applies to Fourier transforms.' };
            }
            const innerOptions = splitTopLevel(scientificHelper.inner, ',').slice(1);
            for (const key of ['dir', 'convention']) {
                if (parsed.options[key] && innerOptions.some((part) => new RegExp(`^\\s*${key}\\s*:`, 'i').test(part))) {
                    return { success: false, error: `Specify ${key} inside or after the helper, not both.` };
                }
            }
            const extras = ['dir', 'convention'].filter((key) => parsed.options[key])
                .map((key) => `${key}:${parsed.options[key]}`);
            const combined = [scientificHelper.inner, ...extras].join(', ');
            const optionParts = [parsed.rawOptions.assume, `mode:${mode}`].filter(Boolean);
            const expression = `${scientificHelper.name}[${combined}] ${optionParts.join(' ')}`;
            return renderSolverResult(solver.solveEquation, expression);
        }
        return renderSolverResult(
            () => solver.solveScientific(scientificHelper.name, scientificHelper.inner, parsed.options)
        );
    }
    if (bracketHelper) {
        if (parsed.options.assume || parsed.options.domain || parsed.options.dir || parsed.options.convention) {
            return { success: false, error: 'Those options are not supported for vector operators.' };
        }
        const optionError = validateRouteOptions(parsed, ['vars', 'coords', 'mode'], 'vector operators');
        if (optionError) return { success: false, error: optionError };
        if (mode && mode !== 'simplify') {
            return {
                success: false,
                error: `mode:${mode} is not supported for ${bracketHelper.name}[...]. Send the helper directly to !solve without an expression mode.`
            };
        }

        const innerParts = splitTopLevel(bracketHelper.inner, ',');
        const hasInnerVars = innerParts.slice(1).some((part) => /^\s*vars\s*:/i.test(part));
        if (parsed.rawOptions.vars && hasInnerVars) {
            return { success: false, error: 'Specify vars either inside the helper or after it, not both.' };
        }
        const helperBody = parsed.rawOptions.vars
            ? `${bracketHelper.inner}, vars:{${parsed.variables.map((entry) => entry.name).join(', ')}}`
            : bracketHelper.inner;

        if (HAS_SCIENTIFIC_HELPER.test(helperBody)) {
            if (!parsed.options.coords || parsed.options.coords === 'cartesian') {
                return renderSolverResult(async () => {
                    const result = await solver.solveEquation(`${bracketHelper.name}[${helperBody}] mode:simplify`);
                    if (result.success && result.latex && parsed.options.coords === 'cartesian') {
                        result.latex = result.latex.replace('\\begin{aligned}\n', '\\begin{aligned}\n\\text{Cartesian coordinates} \\\\\n');
                    }
                    return result;
                });
            }
            const expanded = await expandScientificPlot(helperBody);
            if (!expanded.success) return expanded;
            if (expanded.seriesTruncated) {
                return { success: false, error: 'A series remainder cannot be discarded in a curvilinear vector operation.' };
            }
            return renderSolverResult(() => appendHelperNotes(
                solver.solveCurvilinear(bracketHelper.name, expanded.expression, parsed.options.coords), expanded.notes));
        }

        if (parsed.options.coords && parsed.options.coords !== 'cartesian') {
            return renderSolverResult(
                () => solver.solveCurvilinear(bracketHelper.name, helperBody, parsed.options.coords)
            );
        }

        const helperInputResult = buildVectorHelperInput(bracketHelper.name, helperBody);
        if (!helperInputResult.success) {
            return { success: false, error: helperInputResult.error };
        }
        const helperInput = helperInputResult.input;
        const operators = {
            grad: solver.solveGradient,
            lap: solver.solveLaplacian,
            div: solver.solveDivergence,
            curl: solver.solveCurl
        };
        const operator = operators[bracketHelper.name];
        if (parsed.options.coords === 'cartesian') {
            return renderSolverResult(async () => {
                const result = await Promise.resolve(operator(helperInput));
                if (result.success && result.latex) {
                    result.latex = result.latex.replace('\\begin{aligned}\n', '\\begin{aligned}\n\\text{Cartesian coordinates} \\\\\n');
                }
                return result;
            });
        }
        return renderSolverResult(operator, helperInput);
    }

    if (parsed.options.coords || parsed.options.dir || parsed.options.convention) {
        return { success: false, error: 'Coordinate, direction, and Fourier convention options require their corresponding helper.' };
    }

    if (mode === 'factor' || mode === 'expand' || mode === 'simplify') {
        const optionError = validateRouteOptions(parsed, ['mode', 'assume'], 'expression transformations');
        if (optionError) return { success: false, error: optionError };
        if (/\b(?:eigen|eig|eigs)\s*\(/i.test(body) && looksLikeMatrix(body)) {
            return { success: false, error: 'Eigenvalue operations do not support expression modes. Remove mode to evaluate the matrix operation.' };
        }
        return renderSolverResult(solver.solveEquation, withSolveMode(parsed, mode));
    }

    if (looksLikePde(body, parsed.options)) {
        if (parsed.options.assume || parsed.options.domain) {
            return { success: false, error: 'Assumptions and domain options are not yet supported for PDEs.' };
        }
        const optionError = validateRouteOptions(parsed, ['ic', 'bc', 'view', 'camera'], 'PDEs', { allowRanges: true });
        if (optionError) return { success: false, error: optionError };
        if (parsed.ranges.length > 2) return { success: false, error: 'PDEs support at most one spatial and one time range.' };
        return handlePdeCommand(input);
    }
    if (looksLikeOde(body, parsed.options)) {
        if (parsed.options.assume || parsed.options.domain) {
            return { success: false, error: 'Assumptions and domain options are not yet supported for ODEs.' };
        }
        const optionError = validateRouteOptions(parsed, ['ic', 'mode', 'phase'], 'ODEs', { allowRanges: true });
        if (optionError) return { success: false, error: optionError };
        const maxRanges = parsed.options.phase ? 3 : 2;
        if (parsed.ranges.length > maxRanges) return { success: false, error: 'Too many ranges for this ODE plot.' };
        return handleOdeCommand(input);
    }

    if (mode === 'sym' || mode === 'num' || mode === 'hybrid') {
        return {
            success: false,
            error: 'mode:sym, mode:num, and mode:hybrid only apply when !solve auto-detects an ODE or PDE.'
        };
    }

    if (hasRelation) {
        const optionError = validateRouteOptions(parsed, ['vars', 'assume', 'domain'], 'equation solving', { allowRanges: true });
        if (optionError) return { success: false, error: optionError };
        if (/\b(?:eigen|eig|eigs)\s*\(/i.test(body) && looksLikeMatrix(body)) {
            return { success: false, error: 'Eigenvalue operations cannot be used as scalar equations. Evaluate the matrix operation separately.' };
        }
        return renderSolverResult(solver.solveEquation, input);
    }

    if (looksLikeMatrix(body)) {
        if (parsed.options.assume || parsed.options.domain) {
            return { success: false, error: 'Assumptions and domain options are not supported for matrix operations. Matrix equations can use them.' };
        }
        const optionError = validateRouteOptions(parsed, [], 'matrix operations');
        if (optionError) return { success: false, error: optionError };
        if (HAS_SCIENTIFIC_HELPER.test(body)) {
            const expanded = await expandScientificPlot(body);
            if (!expanded.success) return expanded;
            if (expanded.seriesTruncated) {
                return { success: false, error: 'A series remainder cannot be discarded in a matrix operation.' };
            }
            return renderSolverResult(() => appendHelperNotes(solver.solveMatrixExpression(expanded.expression), expanded.notes));
        }
        return renderSolverResult(solver.solveMatrixExpression, body);
    }

    if (looksAmbiguousSolveTuple(body)) {
        return {
            success: false,
            error: 'Ambiguous solve: Bare tuples are not routed automatically. Wrap the tuple in a helper such as div[(...), vars:{x, y, z}] or curl[(...), vars:{x, y, z}].'
        };
    }

    const optionError = validateRouteOptions(parsed, ['assume'], 'expression simplification');
    if (optionError) return { success: false, error: optionError };
    return renderSolverResult(solver.solveEquation, withSolveMode(parsed, 'simplify'));
}

module.exports = handleSolveCommand;
module.exports.looksLikeMatrix = looksLikeMatrix;
module.exports.looksLikeOde = looksLikeOde;
module.exports.looksLikePde = looksLikePde;
module.exports.hasTopLevelRelation = hasTopLevelRelation;
module.exports.looksAmbiguousSolveTuple = looksAmbiguousSolveTuple;
module.exports.renderSolverResult = renderSolverResult;
