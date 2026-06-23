/**
 * Splits a text by a delimiter at the top level (outside of parentheses, brackets, braces, and quotes).
 * @param {string} text 
 * @param {string} delimiter 
 * @returns {string[]}
 */
function splitTopLevel(text, delimiter = ',') {
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

        if (char === '"' || char === '\'') {
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
            if (trimmed) {
                parts.push(trimmed);
            }
            current = '';
            continue;
        }

        current += char;
    }

    const tail = current.trim();
    if (tail) {
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

function preprocessCalculusHelpers(input) {
    if (typeof input !== 'string') return input;

    let result = '';
    let i = 0;

    while (i < input.length) {
        const isDeriv = input.startsWith('deriv[', i);
        const isInteg = input.startsWith('integ[', i);

        if (isDeriv || isInteg) {
            const helperName = isDeriv ? 'deriv' : 'integ';
            const openBracketIdx = i + 5; // index of '['

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

                if (char === '"' || char === '\'') {
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
                const rawArgs = splitTopLevel(preprocessedInside, ',');
                const quotedArgs = rawArgs.map(arg => {
                    const trimmed = arg.trim();
                    // If it's already fully wrapped in double or single quotes, keep it
                    if (
                        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
                        (trimmed.startsWith("'") && trimmed.endsWith("'"))
                    ) {
                        return trimmed;
                    }
                    // Otherwise wrap in double quotes, escaping any inner double quotes
                    const escaped = trimmed.replace(/"/g, '\\"');
                    return `"${escaped}"`;
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
    preprocessCalculusHelpers
};
