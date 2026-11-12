/**
 * Splits a text by a delimiter at the top level (outside of parentheses, brackets, braces, and quotes).
 * @param {string} text 
 * @param {string} delimiter 
 * @returns {string[]}
 */
function splitTopLevel(text, delimiter = ',', options = {}) {
    const parts = [];
    let current = '';
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let inQuotes = false;
    let quoteChar = null;

    for (let index = 0; index < text.length; index++) {
        const char = text[index];

        if (inQuotes) {
            current += char;
            if (char === '\\' && index + 1 < text.length) {
                current += text[index + 1];
                index++;
                continue;
            }
            if (char === quoteChar) {
                inQuotes = false;
                quoteChar = null;
            }
            continue;
        }

        if (char === '"' || (char === '\'' && !(index > 0 && /^[a-zA-Z0-9_'}\)]/.test(text[index - 1])))) {
            inQuotes = true;
            quoteChar = char;
            current += char;
            continue;
        }

        if (char === '(') {
            parenDepth++;
            current += char;
            continue;
        }
        if (char === ')') {
            parenDepth = Math.max(0, parenDepth - 1);
            current += char;
            continue;
        }
        if (char === '[') {
            bracketDepth++;
            current += char;
            continue;
        }
        if (char === ']') {
            bracketDepth = Math.max(0, bracketDepth - 1);
            current += char;
            continue;
        }
        if (char === '{') {
            braceDepth++;
            current += char;
            continue;
        }
        if (char === '}') {
            braceDepth = Math.max(0, braceDepth - 1);
            current += char;
            continue;
        }

        if (
            char === delimiter &&
            parenDepth === 0 &&
            bracketDepth === 0 &&
            braceDepth === 0
        ) {
            const trimmed = current.trim();
            if (trimmed || options.preserveEmpty) {
                parts.push(trimmed);
            }
            current = '';
            continue;
        }

        current += char;
    }

    const tail = current.trim();
    if (tail || options.preserveEmpty) {
        parts.push(tail);
    }

    return parts;
}

/**
 * Combines LaTeX lines inside an aligned block.
 * @param {string[]} lines 
 * @returns {string}
 */
function buildLatex(lines) {
    return '\\begin{aligned}\n' + lines.join(' \\\\\n') + '\n\\end{aligned}';
}

const GREEK_LETTERS = new Set([
    'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta',
    'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma',
    'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega'
]);

function formatVarToTex(variableName) {
    if (!variableName) return '';
    const lower = variableName.toLowerCase();
    if (GREEK_LETTERS.has(lower)) {
        return '\\' + lower;
    }
    return variableName;
}

const INLINE_BRACKET_HELPERS = [
    'invlaplace',
    'invfourier',
    'dimension',
    'laplace',
    'fourier',
    'convert',
    'series',
    'limit',
    'gradx',
    'grady',
    'gradz',
    'curlx',
    'curly',
    'curlz',
    'deriv',
    'integ',
    'grad',
    'curl',
    'lap',
    'div'
];

// Keep this aligned with python/math_utils.py: other built-in numeric names
// (such as E, PI, phi, and tau) may be ordinary mathematical variables.
const RESERVED_MATH_CONSTANTS = new Set(['pi', 'e', 'i', 'inf', 'infinity', 'true', 'false', 'NaN', 'null', 'Infinity']);
const MATHJS_VARIABLE_NAMES = new Set([
    'E', 'PI', 'phi', 'tau', 'LN10', 'LN2', 'LOG10E', 'LOG2E', 'SQRT1_2', 'SQRT2',
    'efimovFactor', 'fineStructure', 'sackurTetrode', 'weakMixingAngle'
]);

function isReservedMathSymbol(math, name) {
    return RESERVED_MATH_CONSTANTS.has(name) ||
        (Object.prototype.hasOwnProperty.call(math, name) && typeof math[name] === 'function');
}

function quoteMathStringLiteral(value) {
    return JSON.stringify(String(value));
}

function isHelperBoundary(input, index) {
    if (index === 0 || !/[A-Za-z0-9_]/.test(input[index - 1])) return true;
    // Numeric coefficients such as 2deriv[...] are multiplication, while
    // the suffix of a variable such as my2deriv is not a helper name.
    const previousToken = input.slice(0, index).match(/[A-Za-z0-9_.]+$/);
    return Boolean(previousToken && /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE]\d+)?$/.test(previousToken[0]));
}

function preprocessCalculusHelpers(input) {
    if (typeof input !== 'string') return input;

    let result = '';
    let i = 0;

    while (i < input.length) {
        const atIdentifierBoundary = isHelperBoundary(input, i);
        const helperMatch = atIdentifierBoundary && input.slice(i).match(/^([A-Za-z][A-Za-z0-9_]*)\s*\[/);
        const helperName = helperMatch && INLINE_BRACKET_HELPERS.includes(helperMatch[1].toLowerCase())
            ? helperMatch[1].toLowerCase() : null;

        if (helperName) {
            const openBracketIdx = i + helperMatch[0].length - 1;

            // Scan for the matching close bracket ']'
            let depth = 1;
            let parenDepth = 0;
            let braceDepth = 0;
            let inQuotes = false;
            let quoteChar = null;
            let j = openBracketIdx + 1;

            while (j < input.length && depth > 0) {
                const char = input[j];

                if (inQuotes) {
                    if (char === '\\' && j + 1 < input.length) {
                        j += 2;
                        continue;
                    }
                    if (char === quoteChar) {
                        inQuotes = false;
                        quoteChar = null;
                    }
                    j++;
                    continue;
                }

                if (char === '"' || (char === '\'' && !(j > openBracketIdx + 1 && /^[a-zA-Z0-9_'}\)]/.test(input[j - 1])))) {
                    inQuotes = true;
                    quoteChar = char;
                    j++;
                    continue;
                }

                if (char === '(') parenDepth++;
                else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
                else if (char === '{') braceDepth++;
                else if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
                else if (char === '[') {
                    if (parenDepth === 0 && braceDepth === 0) {
                        depth++;
                    }
                } else if (char === ']') {
                    if (parenDepth === 0 && braceDepth === 0) {
                        depth--;
                    }
                }

                j++;
            }

            if (depth === 0) {
                const inside = input.substring(openBracketIdx + 1, j - 1);

                // Recursively preprocess inside content first to handle nested helpers
                const preprocessedInside = preprocessCalculusHelpers(inside);

                // Split inside arguments by top-level commas
                const rawArgs = splitTopLevel(preprocessedInside, ',', { preserveEmpty: true });
                const quotedArgs = rawArgs.map(arg => {
                    const trimmed = arg.trim();
                    // If it's already fully wrapped in double or single quotes, keep it
                    if (
                        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
                        (trimmed.startsWith("'") && trimmed.endsWith("'"))
                    ) {
                        return trimmed;
                    }
                    return quoteMathStringLiteral(trimmed);
                }).join(', ');

                result += `${helperName}(${quotedArgs})`;
                i = j;
                continue;
            }
        }

        result += input[i];
        i++;
    }

    return result;
}

module.exports = {
    splitTopLevel,
    buildLatex,
    formatVarToTex,
    isReservedMathSymbol,
    MATHJS_VARIABLE_NAMES,
    isHelperBoundary,
    preprocessCalculusHelpers
};
