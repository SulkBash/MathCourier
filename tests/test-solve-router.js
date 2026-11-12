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
            solveScientific: async (operation, input, options) => {
                calls.push({ fn: 'solveScientific', operation, input, options });
                return { success: true, latex: 'SCI:' + operation };
            },
            solveCurvilinear: async (operation, input, coords) => {
                calls.push({ fn: 'solveCurvilinear', operation, input, coords });
                return { success: true, latex: 'COORD:' + operation };
            },
            solveMatrixExpression: async (input) => {
                calls.push({ fn: 'solveMatrixExpression', input });
                return { success: true, latex: `MATRIX:${input}` };
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
        const result = await handleSolveCommand('limit[sin(x)/x, x, 0] dir:left');
        assert.strictEqual(result.success, true);
        assert.strictEqual(calls[0].fn, 'solveScientific');
        assert.strictEqual(calls[0].operation, 'limit');
        assert.strictEqual(calls[0].options.dir, 'left');
        console.log('PASS: Scientific helpers route with options');
    }
    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('limit[a*x,x,0] dir:left assume:{a>0} mode:simplify');
        assert.strictEqual(result.success, true);
        assert.strictEqual(calls[0].fn, 'solveEquation');
        assert.strictEqual(calls[0].input, 'limit[a*x,x,0, dir:left] assume:{a>0} mode:simplify');
        console.log('PASS: Expression modes preserve scientific helper options');
    }
    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('grad[r^2] coords:spherical');
        assert.strictEqual(result.success, true);
        assert.strictEqual(calls[0].fn, 'solveCurvilinear');
        assert.strictEqual(calls[0].coords, 'spherical');
        console.log('PASS: Curvilinear vector helpers route by coordinate system');
    }
    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('grad[x^2+y^2] vars:{y,x}');
        assert.strictEqual(result.success, true);
        assert.strictEqual(calls[0].input, 'x^2+y^2 vars:{y, x}');
        console.log('PASS: Outer vector vars reach the Cartesian solver');
    }
    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('grad[rho^2] vars:{rho,alpha,beta} coords:spherical');
        assert.strictEqual(result.success, true);
        assert.strictEqual(calls[0].input, 'rho^2, vars:{rho, alpha, beta}');
        console.log('PASS: Outer vector vars reach the curvilinear solver');
    }
    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('grad[x^2, vars:{x}] vars:{y}');
        assert.strictEqual(result.success, false);
        assert.match(result.error, /either inside.*not both/i);
        assert.deepStrictEqual(calls, []);
        console.log('PASS: Conflicting inner and outer vector vars are rejected');
    }
    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('x=1 kind:vector');
        assert.strictEqual(result.success, false);
        assert.match(result.error, /kind.*not supported/i);
        assert.deepStrictEqual(calls, []);
        console.log('PASS: Equation options cannot be silently ignored');
    }
    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('sqrt(x^2) assume:{x:real}');
        assert.strictEqual(result.success, true);
        assert.strictEqual(calls[0].input, 'sqrt(x^2) assume:{x:real} mode:simplify');
        console.log('PASS: Assumptions survive expression-mode routing');
    }

    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('deriv[x^3, x]');
        assert.strictEqual(result.route, 'render');
        assert.deepStrictEqual(calls.map((entry) => entry.fn), ['solveEquation', 'render']);
        assert.strictEqual(calls[0].input, 'deriv[x^3, x] mode:simplify');
        console.log('PASS: deriv[...] routes through the unified equation solver');
    }

    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('integ[sin(x), x:[0, pi]]');
        assert.strictEqual(result.route, 'render');
        assert.deepStrictEqual(calls.map((entry) => entry.fn), ['solveEquation', 'render']);
        assert.strictEqual(calls[0].input, 'integ[sin(x), x:[0, pi]] mode:simplify');
        console.log('PASS: integ[...] routes through the unified equation solver');
    }

    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('grad[x^2*y*z, vars:{x, y, z}]');
        assert.strictEqual(result.route, 'render');
        assert.deepStrictEqual(calls.map((entry) => entry.fn), ['solveGradient', 'render']);
        assert.strictEqual(calls[0].input, 'x^2*y*z vars:{x, y, z}');
        console.log('PASS: grad[...] routes through the dedicated vector solver');
    }

    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('lap[x^2 + y^2 + z^2, vars:{x, y, z}]');
        assert.strictEqual(result.route, 'render');
        assert.deepStrictEqual(calls.map((entry) => entry.fn), ['solveLaplacian', 'render']);
        assert.strictEqual(calls[0].input, 'x^2 + y^2 + z^2 vars:{x, y, z}');
        console.log('PASS: lap[...] routes through the dedicated vector solver');
    }

    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('div[(x^2, y^2, z^2), vars:{x, y, z}]');
        assert.strictEqual(result.route, 'render');
        assert.deepStrictEqual(calls.map((entry) => entry.fn), ['solveDivergence', 'render']);
        assert.strictEqual(calls[0].input, '(x^2, y^2, z^2) vars:{x, y, z}');
        console.log('PASS: div[...] routes through the dedicated vector solver');
    }

    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('curl[(y*z, x*z, x*y), vars:{x, y, z}]');
        assert.strictEqual(result.route, 'render');
        assert.deepStrictEqual(calls.map((entry) => entry.fn), ['solveCurl', 'render']);
        assert.strictEqual(calls[0].input, '(y*z, x*z, x*y) vars:{x, y, z}');
        console.log('PASS: curl[...] routes through the dedicated vector solver');
    }

    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('grad[x^2*y*z, x, y, z]');
        assert.strictEqual(result.success, false);
        assert(result.error.includes('no longer accepts positional coordinate arguments'));
        assert.deepStrictEqual(calls, []);
        console.log('PASS: positional grad[...] syntax is rejected');
    }

    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('det([1,2;3,4])');
        assert.strictEqual(result.route, 'render');
        assert.deepStrictEqual(calls.map((entry) => entry.fn), ['solveMatrixExpression', 'render']);
        assert.strictEqual(calls[0].input, 'det([1,2;3,4])');
        console.log('PASS: Matrix expressions auto-route without removed mode overrides');
    }

    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('dy/dx = -y ic:{y(0)=1}');
        assert.strictEqual(result.route, 'ode');
        assert.deepStrictEqual(calls.map((entry) => entry.fn), ['handleOdeCommand']);
        assert.strictEqual(calls[0].input, 'dy/dx = -y ic:{y(0)=1}');
        console.log('PASS: ODEs auto-route without removed mode overrides');
    }
    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('du/dt=d2u/dx2 ic:{u(x,0)=sin(x)} bc:{u(0,t)=0} view:2d camera:z');
        assert.strictEqual(result.route, 'pde');
        assert.strictEqual(calls[0].fn, 'handlePdeCommand');
        console.log('PASS: PDE camera options reach the correct route');
    }

    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('x^3 mode:diff');
        assert.strictEqual(result.success, false);
        assert(result.error.includes('Route "diff" has been removed'));
        assert.deepStrictEqual(calls, []);
        console.log('PASS: Removed mode:diff surface now returns a guidance error');
    }

    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('diff x^3');
        assert.strictEqual(result.success, false);
        assert(result.error.includes('Route "diff" has been removed'));
        assert.deepStrictEqual(calls, []);
        console.log('PASS: Removed prefixed diff syntax now returns a guidance error');
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
        assert.strictEqual(result.route, 'render');
        assert.strictEqual(result.latex, 'EQ:x^2 = 4');
        assert.deepStrictEqual(calls.map((entry) => entry.fn), ['solveEquation', 'render']);
        assert.strictEqual(calls[0].input, 'x^2 = 4');
        console.log('PASS: Relational expressions route to the equation solver and render');
    }

    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('x^2 - 1 > 0');
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.route, 'render');
        assert.strictEqual(result.latex, 'EQ:x^2 - 1 > 0');
        assert.deepStrictEqual(calls.map((entry) => entry.fn), ['solveEquation', 'render']);
        assert.strictEqual(calls[0].input, 'x^2 - 1 > 0');
        console.log('PASS: Inequalities route to the equation solver and render');
    }

    {
        const { handleSolveCommand, calls } = loadSolveRouter();
        const result = await handleSolveCommand('(x-1)^3 mode:expand');
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.route, 'render');
        assert.strictEqual(result.latex, 'EQ:(x-1)^3 mode:expand');
        assert.deepStrictEqual(calls.map((entry) => entry.fn), ['solveEquation', 'render']);
        assert.strictEqual(calls[0].input, '(x-1)^3 mode:expand');
        console.log('PASS: Expression modes route through the symbolic equation solver and render');
    }

    console.log('=== SOLVE ROUTER TESTS PASSED ===');
}

run().catch((error) => {
    console.error('Fatal solve router test error:', error);
    process.exitCode = 1;
});
