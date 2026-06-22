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

module.exports = {
    splitTopLevel,
    buildLatex
};
