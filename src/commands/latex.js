const renderer = require('../renderer');
const { parseCommandSyntax } = require('../parser');

const VALID_MODES = new Set(['formula', 'chem', 'tikz']);

function normalizeMode(mode) {
    if (mode === undefined || mode === null) {
        return null;
    }

    return String(mode).toLowerCase().trim();
}

function detectLatexMode(body) {
    const source = String(body || '');

    // Follow the stricter command_refactor edge-case rules so plain text like
    // "\node" does not accidentally trigger QuickLaTeX TikZ compilation.
    if (/\\begin\{tikzpicture\}|\\tikz\b|\\begin\{circuitikz\}/i.test(source)) {
        return 'tikz';
    }

    if (/\\chemfig\s*\{|\\setchemfig\b/i.test(source)) {
        return 'chem';
    }

    return 'formula';
}

async function handleLatexCommand(input, options = {}) {
    const parsed = parseCommandSyntax(input);
    if (!parsed.success) {
        return { success: false, error: parsed.errors.join('\n') };
    }

    const body = (parsed.body || '').trim();
    if (!body) {
        return { success: false, error: 'Missing command body.' };
    }

    const explicitMode = normalizeMode(options.mode) || normalizeMode(parsed.options.mode);
    if (explicitMode && !VALID_MODES.has(explicitMode)) {
        return {
            success: false,
            error: `Invalid mode "${explicitMode}". Expected one of: formula, chem, tikz.`
        };
    }

    const mode = explicitMode || detectLatexMode(body);

    switch (mode) {
        case 'chem':
            return renderer.renderChem(body);
        case 'tikz':
            return renderer.renderTikz(body);
        case 'formula':
        default:
            return renderer.render(body, true);
    }
}

module.exports = handleLatexCommand;
module.exports.detectLatexMode = detectLatexMode;
