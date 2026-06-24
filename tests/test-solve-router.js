const assert = require('assert');

function loadSolveRouter() {
    const calls = [];

    const rendererPath = require.resolve('../src/renderer');
    const solverPath = require.resolve('../src/solver');
    const odePath = require.resolve('../src/commands/ode');
    const pdePath = require.resolve('../src/commands/pde');
    const solvePath = require.resolve('../src/commands/solve');

    require.cache[rendererPath] = {
        id: rendererPath,
        filename: rendererPath,
        loaded: true,
        exports: {
            render: async (latex, isDisplayMode) => {
                calls.push({ fn: 'render', latex, isDisplayMode });
                return { success: true, route: 'render', latex, isDisplayMode };
            }
        }
    };

    require.cache[solverPath] = {
        id: solverPath,
        filename: solverPath,
        loaded: true,
        exports: {
            solveEquation: async (input) => {
                calls.push({ fn: 'solveEquation', input });
                return { success: true, latex: `EQ:${input}` };
            },
            solveDerivative: async (input) => {
                calls.push({ fn: 'solveDerivative', input });
                return { success: true, latex: `DIFF:${input}` };
            },
            solveIntegral: async (input) => {
                calls.push({ fn: 'solveIntegral', input });
                return { success: true, latex: `INT:${input}` };
            },
            solveGradient: async (input) => {
                calls.push({ fn: 'solveGradient', input });
                return { success: true, latex: `GRAD:${input}` };
            },
            solveLaplacian: async (input) => {
                calls.push({ fn: 'solveLaplacian', input });
                return { success: true, latex: `LAP:${input}` };
            },
            solveDivergence: async (input) => {
                calls.push({ fn: 'solveDivergence', input });
                return { success: true, latex: `DIV:${input}` };
            },
            solveCurl: async (input) => {
                calls.push({ fn: 'solveCurl', input });
                return { success: true, latex: `CURL:${input}` };
            },
            solveMatrixExpression: async (input) => {
                calls.push({ fn: 'solveMatrixExpression', input });
                return { success: true, latex: `MATRIX:${input}` };
            }
        }
    };

    require.cache[odePath] = {
        id: odePath,
        filename: odePath,
        loaded: true,
        exports: async (input) => {
            calls.push({ fn: 'handleOdeCommand', input });
            return { success: true, route: 'ode', input };
        }
    };

    require.cache[pdePath] = {
        id: pdePath,
        filename: pdePath,
        loaded: true,
        exports: async (input) => {
            calls.push({ fn: 'handlePdeCommand', input });
            return { success: true, route: 'pde', input };
        }
    };

    delete require.cache[solvePath];
    const handleSolveCommand = require('../src/commands/solve');
    return { handleSolveCommand, calls };
}

async function run() {
    console.log('=== RUNNING SOLVE ROUTER TESTS ===');

    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('x^3 mode:diff');
        assert.strictEqual(result.route, 'render');
        assert.deepStrictEqual(calls.map((entry) => entry.fn), ['solveDerivative', 'render']);
        assert.strictEqual(calls[0].input, 'x^3');
        console.log('PASS: mode:diff routes to the derivative solver');
    }

    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('sin(x) x:[0, pi] mode:int');
        assert.strictEqual(result.route, 'render');
        assert.deepStrictEqual(calls.map((entry) => entry.fn), ['solveIntegral', 'render']);
        assert.strictEqual(calls[0].input, 'sin(x) x:[0, pi]');
        console.log('PASS: mode:int routes to the integral solver');
    }

    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('x^2*y*z mode:grad');
        assert.strictEqual(result.route, 'render');
        assert.deepStrictEqual(calls.map((entry) => entry.fn), ['solveGradient', 'render']);
        assert.strictEqual(calls[0].input, 'x^2*y*z');
        console.log('PASS: mode:grad routes to the gradient solver');
    }

    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('det([1,2;3,4]) mode:matrix');
        assert.strictEqual(result.route, 'render');
        assert.deepStrictEqual(calls.map((entry) => entry.fn), ['solveMatrixExpression', 'render']);
        assert.strictEqual(calls[0].input, 'det([1,2;3,4])');
        console.log('PASS: mode:matrix routes to the matrix solver');
    }

    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('dy/dx = -y ic:{y(0)=1} mode:ode');
        assert.strictEqual(result.route, 'ode');
        assert.deepStrictEqual(calls.map((entry) => entry.fn), ['handleOdeCommand']);
        assert.strictEqual(calls[0].input, 'dy/dx = -y ic:{y(0)=1}');
        console.log('PASS: mode:ode routes to the ODE handler');
    }

    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('(-y, x, 0)');
        assert.strictEqual(result.success, false);
        assert(result.error.includes('Ambiguous solve'));
        assert.deepStrictEqual(calls, []);
        console.log('PASS: Bare tuples fail with an ambiguity error');
    }

    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('x^2 = 4');
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.latex, 'EQ:x^2 = 4');
        assert.deepStrictEqual(calls.map((entry) => entry.fn), ['solveEquation']);
        assert.strictEqual(calls[0].input, 'x^2 = 4');
        console.log('PASS: Relational expressions route to the equation solver');
    }

    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('x^2 - 1 > 0');
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.latex, 'EQ:x^2 - 1 > 0');
        assert.deepStrictEqual(calls.map((entry) => entry.fn), ['solveEquation']);
        assert.strictEqual(calls[0].input, 'x^2 - 1 > 0');
        console.log('PASS: Inequalities route to the equation solver');
    }

    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('(x-1)^3 mode:expand');
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.latex, 'EQ:(x-1)^3 mode:expand');
        assert.deepStrictEqual(calls.map((entry) => entry.fn), ['solveEquation']);
        assert.strictEqual(calls[0].input, '(x-1)^3 mode:expand');
        console.log('PASS: Expression modes route through the symbolic equation solver');
    }

    console.log('=== SOLVE ROUTER TESTS PASSED ===');
}

run().catch((error) => {
    console.error('Fatal solve router test error:', error);
    process.exitCode = 1;
});
