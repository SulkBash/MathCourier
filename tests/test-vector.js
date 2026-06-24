const assert = require('assert');
const math = require('../src/math');
const solver = require('../src/solver');

const cases = [
    {
        name: 'Gradient infers x, y, z from a 3D scalar field',
        run: () => solver.solveGradient('x^2 * y * z'),
        verify: (result) => {
            assert.strictEqual(result.success, true);
            assert.deepStrictEqual(result.variables, ['x', 'y', 'z']);
            assert.strictEqual(result.dimension, 3);
            assert.ok(result.latex.includes('\\nabla f'));
            assert.ok(result.latex.includes('\\left\\langle'));
        }
    },
    {
        name: 'Gradient respects explicit 2D variables',
        run: () => solver.solveGradient('x^2 + y^2 vars:{x, y}'),
        verify: (result) => {
            assert.strictEqual(result.success, true);
            assert.deepStrictEqual(result.variables, ['x', 'y']);
            assert.strictEqual(result.dimension, 2);
            assert.ok(result.latex.includes('f(x, y)'));
        }
    },
    {
        name: 'Laplacian handles a 2D scalar field',
        run: () => solver.solveLaplacian('x^2 + y^2 vars:{x, y}'),
        verify: (result) => {
            assert.strictEqual(result.success, true);
            assert.deepStrictEqual(result.variables, ['x', 'y']);
            assert.strictEqual(result.dimension, 2);
            assert.ok(result.latex.includes('\\nabla^2 f'));
            assert.ok(result.latex.includes('4'));
        }
    },
    {
        name: 'Divergence handles a 3D vector field',
        run: () => solver.solveDivergence('(x^2, y^2, z^2)'),
        verify: (result) => {
            assert.strictEqual(result.success, true);
            assert.deepStrictEqual(result.variables, ['x', 'y', 'z']);
            assert.strictEqual(result.dimension, 3);
            assert.ok(result.latex.includes('\\nabla \\cdot \\mathbf{F}'));
        }
    },
    {
        name: 'Curl handles a 2D vector field',
        run: () => solver.solveCurl('(-y, x)'),
        verify: (result) => {
            assert.strictEqual(result.success, true);
            assert.deepStrictEqual(result.variables, ['x', 'y']);
            assert.strictEqual(result.dimension, 2);
            assert.ok(result.latex.includes('\\nabla \\times \\mathbf{F}'));
            assert.ok(result.latex.includes('2'));
        }
    },
    {
        name: 'Curl handles a 3D vector field',
        run: () => solver.solveCurl('(-y, x, 0)'),
        verify: (result) => {
            assert.strictEqual(result.success, true);
            assert.deepStrictEqual(result.variables, ['x', 'y', 'z']);
            assert.strictEqual(result.dimension, 3);
            assert.ok(result.latex.includes('\\left\\langle'));
        }
    },
    {
        name: 'Ambiguous 3D divergence asks for explicit variables',
        run: () => solver.solveDivergence('(r, 0, 0)'),
        verify: (result) => {
            assert.strictEqual(result.success, false);
            assert.ok(result.error.includes('Could not infer 3 coordinate variables'));
        }
    },
    {
        name: 'Inline lap evaluates numerically through mathjs',
        run: () => math.evaluate('lap("x^2 + y^2")', { x: 3, y: 4 }),
        verify: (result) => {
            assert.strictEqual(result, 4);
        }
    },
    {
        name: 'Inline div evaluates numerically through mathjs',
        run: () => math.evaluate('div("(x^2, y^2)")', { x: 3, y: 4 }),
        verify: (result) => {
            assert.strictEqual(result, 14);
        }
    },
    {
        name: 'Inline curl evaluates 2D scalar curl through mathjs',
        run: () => math.evaluate('curl("(-y, x)")', { x: 3, y: 4 }),
        verify: (result) => {
            assert.strictEqual(result, 2);
        }
    },
    {
        name: 'Inline gradient helpers evaluate through mathjs',
        run: () => ({
            vector: math.evaluate('grad("x^2 + y^2")', { x: 3, y: 4 }),
            gx: math.evaluate('gradx("x^2 + y^2")', { x: 3, y: 4 }),
            gy: math.evaluate('grady("x^2 + y^2")', { x: 3, y: 4 })
        }),
        verify: (result) => {
            assert.deepStrictEqual(result.vector, [6, 8]);
            assert.strictEqual(result.gx, 6);
            assert.strictEqual(result.gy, 8);
        }
    },
    {
        name: 'Legacy positional vector helper syntax is rejected',
        run: () => {
            assert.throws(
                () => math.evaluate('grad("x^2 + y^2", x, y)', { x: 3, y: 4 }),
                /no longer accepts positional coordinate arguments/
            );
            return true;
        },
        verify: (result) => {
            assert.strictEqual(result, true);
        }
    },
    {
        name: 'Inline 3D curl component helpers evaluate through mathjs',
        run: () => ({
            vector: math.evaluate('curl("(0, 0, x*y)")', { x: 3, y: 4, z: 5 }),
            cx: math.evaluate('curlx("(0, 0, x*y)")', { x: 3, y: 4, z: 5 }),
            cy: math.evaluate('curly("(0, 0, x*y)")', { x: 3, y: 4, z: 5 }),
            cz: math.evaluate('curlz("(0, 0, x*y)")', { x: 3, y: 4, z: 5 })
        }),
        verify: (result) => {
            assert.deepStrictEqual(result.vector, [3, -4, 0]);
            assert.strictEqual(result.cx, 3);
            assert.strictEqual(result.cy, -4);
            assert.strictEqual(result.cz, 0);
        }
    }
];

function main() {
    console.log('=== RUNNING VECTOR OPERATOR TESTS ===\n');

    let failures = 0;
    for (const testCase of cases) {
        try {
            const result = testCase.run();
            testCase.verify(result);
            console.log(`PASS: ${testCase.name}`);
        } catch (err) {
            failures += 1;
            console.error(`FAIL: ${testCase.name}`);
            console.error(err.message);
        }
    }

    if (failures > 0) {
        console.error(`\n${failures} vector operator test(s) failed.`);
        process.exit(1);
    }

    console.log('\nAll vector operator tests passed.');
}

main();
