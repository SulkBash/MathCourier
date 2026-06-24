const renderer = require('../renderer');
const solver = require('../solver');
const { parseCommandSyntax } = require('../parser');
const { preprocessCalculusHelpers, splitTopLevel } = require('../utils');
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
    'curlz'
]);

const MATRIX_FUNCTION_RE = /\b(?:det|inv|inverse|eigen|eig|eigs|rref)\s*\(/i;
const ODE_PATTERN_RE = /(?:\bdy\/dx\b|\bd2y\/dx2\b|\b[a-zA-Z_][a-zA-Z0-9_]*'{1,2}\b|\bd\d*[a-zA-Z_][a-zA-Z0-9_]*\/d[a-zA-Z_][a-zA-Z0-9_]*(?:\d+)?\b)/i;
const PDE_PATTERN_RE = /(?:\bdu\/dt\b|\bd2u\/dx2\b|\bu_t\b|\bu_xx\b)/i;
const ROUTE_PREFIX_RE = /^(diff|int|grad|lap|div|curl|matrix)\s+([\s\S]+)$/i;

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

function extractPrefixedSolveRoute(body) {
    const match = String(body || '').trim().match(ROUTE_PREFIX_RE);
    if (!match) {
        return null;
    }

    return {
        keyword: match[1].toLowerCase(),
        body: match[2].trim()
    };
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

function routeExplicitSolveMode(mode, input, body) {
    switch (mode) {
        case 'diff':
            return renderSolverResult(solver.solveDerivative, input);
        case 'int':
            return renderSolverResult(solver.solveIntegral, input);
        case 'grad':
            return renderSolverResult(solver.solveGradient, input);
        case 'lap':
            return renderSolverResult(solver.solveLaplacian, input);
        case 'div':
            return renderSolverResult(solver.solveDivergence, input);
        case 'curl':
            return renderSolverResult(solver.solveCurl, input);
        case 'matrix':
            return renderSolverResult(solver.solveMatrixExpression, body);
        case 'ode':
            return handleOdeCommand(input);
        case 'pde':
            return handlePdeCommand(input);
        default:
            return null;
    }
}

async function handleSolveCommand(input) {
    const parsed = parseCommandSyntax(input);
    if (!parsed.success) {
        return { success: false, error: parsed.errors.join('\n') };
    }

    const body = (parsed.body || '').trim();
    if (!body) {
        return { success: false, error: 'Missing command body.' };
    }

    const mode = getMode(parsed);
    const strippedInput = rebuildInput(parsed);
    const hasRelation = hasTopLevelRelation(body);

    // Explicit mode overrides used by the unified solve router.
    if (mode === 'factor' || mode === 'expand' || mode === 'simplify') {
        return Promise.resolve(solver.solveEquation(withSolveMode(parsed, mode)));
    }

    if (mode) {
        const explicitRoute = routeExplicitSolveMode(mode, strippedInput, body);
        if (explicitRoute) {
            return explicitRoute;
        }
    }

    const prefixedRoute = extractPrefixedSolveRoute(body);
    if (prefixedRoute) {
        const prefixedInput = rebuildInputWithBody(parsed, prefixedRoute.body);
        return routeExplicitSolveMode(prefixedRoute.keyword, prefixedInput, prefixedRoute.body);
    }

    // Differential-equation routing happens before general symbolic solving.
    if (looksLikePde(body, parsed.options)) {
        return handlePdeCommand(strippedInput);
    }
    if (looksLikeOde(body, parsed.options)) {
        return handleOdeCommand(strippedInput);
    }

    // Relational solving takes precedence over matrix expression evaluation.
    if (hasRelation) {
        return Promise.resolve(solver.solveEquation(input));
    }

    if (looksLikeMatrix(body)) {
        return renderSolverResult(solver.solveMatrixExpression, body);
    }

    if (looksAmbiguousSolveTuple(body)) {
        return {
            success: false,
            error: 'Ambiguous solve: Bare tuples are not routed automatically. Wrap the tuple in a helper such as div[(...), x, y, z] or curl[(...), x, y, z], or choose an explicit mode.'
        };
    }

    return Promise.resolve(solver.solveEquation(withSolveMode(parsed, 'simplify')));
}

module.exports = handleSolveCommand;
module.exports.looksLikeMatrix = looksLikeMatrix;
module.exports.looksLikeOde = looksLikeOde;
module.exports.looksLikePde = looksLikePde;
module.exports.hasTopLevelRelation = hasTopLevelRelation;
module.exports.looksAmbiguousSolveTuple = looksAmbiguousSolveTuple;
module.exports.renderSolverResult = renderSolverResult;
