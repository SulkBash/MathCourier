const assert = require('assert');

function loadLatexRouter() {
    const calls = [];

    const rendererPath = require.resolve('../src/renderer');
    const latexPath = require.resolve('../src/commands/latex');

    require.cache[rendererPath] = {
        id: rendererPath,
        filename: rendererPath,
        loaded: true,
        exports: {
            render: async (body, isDisplayMode) => {
                calls.push({ fn: 'render', body, isDisplayMode });
                return { success: true, route: 'formula', body, isDisplayMode };
            },
            renderChem: async (body) => {
                calls.push({ fn: 'renderChem', body });
                return { success: true, route: 'chem', body };
            },
            renderTikz: async (body) => {
                calls.push({ fn: 'renderTikz', body });
                return { success: true, route: 'tikz', body };
            }
        }
    };

    delete require.cache[latexPath];
    const handleLatexCommand = require('../src/commands/latex');
    return { handleLatexCommand, calls };
}

async function run() {
    console.log('=== RUNNING LATEX ROUTER TESTS ===');

    {
        const { handleLatexCommand, calls } = loadLatexRouter();
        const result = await handleLatexCommand('\\int_0^1 x^2 dx');
        assert.strictEqual(result.route, 'formula');
        assert.deepStrictEqual(calls, [{ fn: 'render', body: '\\int_0^1 x^2 dx', isDisplayMode: true }]);
        console.log('PASS: Plain latex defaults to formula rendering');
    }

    {
        const { handleLatexCommand, calls } = loadLatexRouter();
        const result = await handleLatexCommand('\\chemfig{H-O-H}');
        assert.strictEqual(result.route, 'chem');
        assert.deepStrictEqual(calls, [{ fn: 'renderChem', body: '\\chemfig{H-O-H}' }]);
        console.log('PASS: Chemfig auto-detect routes to renderChem');
    }

    {
        const { handleLatexCommand, calls } = loadLatexRouter();
        const input = '\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}';
        const result = await handleLatexCommand(input);
        assert.strictEqual(result.route, 'tikz');
        assert.deepStrictEqual(calls, [{ fn: 'renderTikz', body: input }]);
        console.log('PASS: TikZ auto-detect routes to renderTikz');
    }

    {
        const { handleLatexCommand, calls } = loadLatexRouter();
        const result = await handleLatexCommand('x^2 + y^2 = 1 mode:chem');
        assert.strictEqual(result.route, 'chem');
        assert.deepStrictEqual(calls, [{ fn: 'renderChem', body: 'x^2 + y^2 = 1' }]);
        console.log('PASS: mode:chem overrides default formula routing');
    }

    {
        const { handleLatexCommand, calls } = loadLatexRouter();
        const result = await handleLatexCommand('x^2 + y^2 = 1 mode:tikz');
        assert.strictEqual(result.route, 'tikz');
        assert.deepStrictEqual(calls, [{ fn: 'renderTikz', body: 'x^2 + y^2 = 1' }]);
        console.log('PASS: mode:tikz overrides default formula routing');
    }

    console.log('=== LATEX ROUTER TESTS PASSED ===');
}

run().catch((error) => {
    console.error('Fatal latex router test error:', error);
    process.exitCode = 1;
});
