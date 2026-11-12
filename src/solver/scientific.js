const path = require('path');
const { splitTopLevel, isHelperBoundary } = require('../utils');
const { runSubprocess } = require('./subprocess');
const math = require('../math');

const SCRIPT = path.join(__dirname, '../../python/scientific_solver.py');
const PLOT_SCRIPT = path.join(__dirname, '../../python/scientific_plot.py');
const ARITY = {
    limit: [3, 3],
    series: [4, 4],
    laplace: [3, 3],
    invlaplace: [3, 3],
    fourier: [3, 3],
    invfourier: [3, 3],
    convert: [2, 2],
    dimension: [1, 1]
};

async function solveScientific(operation, source, options = {}) {
    if (!Object.prototype.hasOwnProperty.call(ARITY, operation)) {
        return { success: false, error: 'Unsupported scientific operation.' };
    }
    const args = splitTopLevel(String(source || ''), ',', { preserveEmpty: true });
    const [min] = ARITY[operation];
    if (args.length < min) {
        return { success: false, error: operation + ' expects ' + min + ' arguments. See !help ' + operation + '.' };
    }
    if (options.dir && operation !== 'limit') {
        return { success: false, error: 'Option "dir" only applies to limits.' };
    }
    if (options.convention && !['fourier', 'invfourier'].includes(operation)) {
        return { success: false, error: 'Option "convention" only applies to Fourier transforms.' };
    }
    if (options.coords || options.domain) {
        return { success: false, error: 'Options "coords" and "domain" do not apply to this helper. Use assume:{...} for symbol properties.' };
    }
    return runSubprocess(SCRIPT, {
        operation,
        args,
        assume: options.assume || null,
        direction: options.dir || null,
        convention: options.convention || null
    });
}

// Extract outermost scientific calls wherever they occur in a plot expression.
// Other helpers stay intact, so e.g. deriv[limit[...], x] is still evaluated
// by the existing in-process derivative implementation after one Python call.
function extractPlotHelpers(source) {
    const tasks = [];
    let prefix = 'MathCourierInline';
    while (source.includes(prefix)) prefix += 'X';
    let output = '';
    let index = 0;
    let quote = null;
    while (index < source.length) {
        const char = source[index];
        if (quote) {
            output += char;
            if (char === '\\' && index + 1 < source.length) output += source[++index];
            else if (char === quote) quote = null;
            index++;
            continue;
        }
        if (char === '"' || (char === "'" && !(index > 0 && /[A-Za-z0-9_')\]}]/.test(source[index - 1])))) {
            quote = char;
            output += char;
            index++;
            continue;
        }
        const boundary = isHelperBoundary(source, index);
        const match = boundary && source.slice(index).match(/^([A-Za-z][A-Za-z0-9_]*)\s*\[/);
        const operation = match && match[1].toLowerCase();
        if (!match || !Object.prototype.hasOwnProperty.call(ARITY, operation)) {
            output += char;
            index++;
            continue;
        }
        const open = index + match[0].length - 1;
        let depth = 1;
        let innerQuote = null;
        let end = open + 1;
        for (; end < source.length && depth; end++) {
            const c = source[end];
            if (innerQuote) {
                if (c === '\\' && end + 1 < source.length) end++;
                else if (c === innerQuote) innerQuote = null;
            } else if (c === '"' || (c === "'" && !/[A-Za-z0-9_')\]}]/.test(source[end - 1] || ''))) {
                innerQuote = c;
            } else if (c === '[') depth++;
            else if (c === ']') depth--;
        }
        if (depth) throw new Error(`Unclosed ${operation}[...] helper.`);
        const placeholder = prefix + tasks.length;
        tasks.push({ operation, args: splitTopLevel(source.slice(open + 1, end - 1), ',', { preserveEmpty: true }) });
        output += placeholder;
        index = end;
    }
    return { expression: output, tasks, prefix };
}

async function expandScientificPlot(source, ranges = []) {
    let extracted;
    try {
        extracted = extractPlotHelpers(String(source));
    } catch (error) {
        return { success: false, error: error.message };
    }
    if (!extracted.tasks.length) return { success: true, expression: source, seriesTruncated: false };
    const domains = Object.fromEntries(ranges.map((range) => [range.name, [range.min, range.max]]));
    const result = await runSubprocess(PLOT_SCRIPT, { tasks: extracted.tasks, ranges: domains });
    if (!result.success) return result;
    if (result.restricted && (/\binteg\s*\[/i.test(source) ||
        (/\bderiv\s*\[/i.test(source) && /\bat\s*:/i.test(source)))) {
        return { success: false, error: 'Cannot safely propagate a Laplace convergence condition through a bounded integral or derivative evaluation in a plot.' };
    }
    let expression = extracted.expression;
    for (let index = 0; index < result.values.length; index++) {
        const value = result.values[index];
        try {
            const node = math.parse(value);
            node.traverse((part) => {
                if (part.isFunctionNode && part.fn.isSymbolNode && typeof math[part.fn.name] !== 'function') {
                    throw new Error(`The plot renderer does not support the function ${part.fn.name}.`);
                }
            });
        } catch (error) {
            return { success: false, error: `Cannot plot this helper result: ${error.message}` };
        }
        expression = expression.replace(extracted.prefix + index, '(' + value + ')');
    }
    return { success: true, expression, seriesTruncated: result.seriesTruncated, notes: result.notes || [] };
}

module.exports = { solveScientific, expandScientificPlot };
