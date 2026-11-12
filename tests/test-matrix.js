const assert = require('assert');
const solver = require('../src/solver');
const { computeRref } = require('../src/solver/matrix');

const cases = [
    {
        name: 'Matrix multiplication returns a rendered matrix result',
        run: () => solver.solveMatrixExpression('[1, 2; 3, 4] * [2, 0; 1, 2]'),
        verify: (result) => {
            assert.strictEqual(result.success, true);
            assert.ok(result.latex.includes('\\begin{bmatrix} 4 & 4 \\\\ 10 & 8 \\end{bmatrix}'));
        }
    },
    {
        name: 'Determinant of a square matrix is computed',
        run: () => solver.solveMatrixExpression('det([1, 2; 3, 4])'),
        verify: (result) => {
            assert.strictEqual(result.success, true);
            assert.ok(result.latex.includes('\\det'));
            assert.ok(result.latex.includes('-2'));
        }
    },
    {
        name: 'Inverse of a square matrix is computed',
        run: () => solver.solveMatrixExpression('inv([1, 2; 3, 4])'),
        verify: (result) => {
            assert.strictEqual(result.success, true);
            assert.ok(result.latex.includes('^{-1}'));
            assert.ok(result.latex.includes('\\begin{bmatrix} -2 & 1 \\\\ \\frac{3}{2} & -\\frac{1}{2} \\end{bmatrix}'));
        }
    },
    {
        name: 'Eigenvalues and eigenvectors are computed',
        run: () => solver.solveMatrixExpression('eigen([1, 2; 2, 1])'),
        verify: (result) => {
            assert.strictEqual(result.success, true);
            assert.ok(result.latex.includes('\\lambda_{1}'));
            assert.ok(result.latex.includes('\\lambda_{2}'));
            assert.ok(result.latex.includes('\\mathbf{v}_{1}'));
            assert.ok(result.latex.includes('\\mathbf{v}_{2}'));
            assert.ok(result.latex.includes('-1'));
            assert.ok(result.latex.includes('3'));
        }
    },
    {
        name: 'Eigenvectors prefer exact direction vectors when available',
        run: () => solver.solveMatrixExpression('eigen([1, 2, 2; 2, 1, 2; 2, 2, 1])'),
        verify: (result) => {
            assert.strictEqual(result.success, true);
            assert.ok(result.latex.includes('\\lambda_{3} &= 5'));
            assert.ok(result.latex.includes('\\begin{bmatrix} 1 \\\\ 1 \\\\ 1 \\end{bmatrix}'));
            assert.ok(result.latex.includes('\\begin{bmatrix} 1 \\\\ -1 \\\\ 0 \\end{bmatrix}'));
            assert.ok(result.latex.includes('\\begin{bmatrix} 1 \\\\ 1 \\\\ -2 \\end{bmatrix}'));
            assert.ok(!result.latex.includes('0.57735026919'));
            assert.ok(!result.latex.includes('0.707106781187'));
        }
    },
    {
        name: 'RREF reduces a singular matrix',
        run: () => solver.solveMatrixExpression('rref([1, 2, 3; 2, 4, 6])'),
        verify: (result) => {
            assert.strictEqual(result.success, true);
            assert.ok(result.latex.includes('\\operatorname{rref}'));
            assert.ok(result.latex.includes('\\begin{bmatrix} 1 & 2 & 3 \\\\ 0 & 0 & 0 \\end{bmatrix}'));
        }
    },
    {
        name: 'Scalar multiplication and matrix addition are supported',
        run: () => solver.solveMatrixExpression('2 * [1, 2; 3, 4] + [1, 1; 1, 1]'),
        verify: (result) => {
            assert.strictEqual(result.success, true);
            assert.ok(result.latex.includes('\\begin{bmatrix} 3 & 5 \\\\ 7 & 9 \\end{bmatrix}'));
        }
    },
    {
        name: 'Small matrix entries survive arithmetic and formatting',
        run: () => solver.solveMatrixExpression('[1e-12, 0; 0, 1] * [1, 0; 0, 1]'),
        verify: (result) => {
            assert.strictEqual(result.success, true);
            assert.ok(result.latex.includes('&= \\begin{bmatrix} 1\\cdot10^{-12} & 0 \\\\ 0 & 1 \\end{bmatrix}'));
        }
    },
    {
        name: 'Small nonzero determinants are preserved',
        run: () => solver.solveMatrixExpression('det([1e-12, 0; 0, 1])'),
        verify: (result) => {
            assert.strictEqual(result.success, true);
            assert.ok(result.latex.includes('&= 1\\cdot10^{-12}'));
        }
    },
    {
        name: 'Values near an integer are not rounded to that integer',
        run: () => solver.solveMatrixExpression('det([1.000000000001, 0; 0, 1])'),
        verify: (result) => {
            assert.strictEqual(result.success, true);
            assert.ok(result.latex.includes('&= 1.000000000001'));
        }
    },
    {
        name: 'Nearby decimals are not presented as exact fractions',
        run: () => solver.solveMatrixExpression('det([0.333333334, 0; 0, 1])'),
        verify: (result) => {
            assert.strictEqual(result.success, true);
            assert.ok(result.latex.includes('&= 0.333333334'));
            assert.ok(!result.latex.includes('&= \\frac{1}{3}'));
        }
    },
    {
        name: 'Small nonzero matrix entries remain invertible',
        run: () => solver.solveMatrixExpression('inv([1e-12, 0; 0, 1])'),
        verify: (result) => {
            assert.strictEqual(result.success, true);
            assert.ok(result.latex.includes('\\begin{bmatrix} 1000000000000 & 0 \\\\ 0 & 1 \\end{bmatrix}'));
        }
    },
    {
        name: 'RREF retains tiny pivots',
        run: () => solver.solveMatrixExpression('rref([1e-17, 1])'),
        verify: (result) => {
            assert.strictEqual(result.success, true);
            assert.ok(result.latex.includes('\\begin{bmatrix} 1 & 100000000000000000 \\end{bmatrix}'));
        }
    },
    {
        name: 'RREF handles numerical cancellation without losing rank',
        run: () => solver.solveMatrixExpression('rref([0.1, 0.2; 0.3, 0.6])'),
        verify: (result) => {
            assert.strictEqual(result.success, true);
            assert.ok(result.latex.includes('\\begin{bmatrix} 1 & 2 \\\\ 0 & 0 \\end{bmatrix}'));
        }
    },
    {
        name: 'RREF preserves a small independent pivot',
        run: () => solver.solveMatrixExpression('rref([1, 1; 1, 1.000000000001])'),
        verify: (result) => {
            assert.strictEqual(result.success, true);
            assert.ok(result.latex.includes('\\begin{bmatrix} 1 & 0 \\\\ 0 & 1 \\end{bmatrix}'));
        }
    },
    {
        name: 'RREF is stable when a matrix is rescaled',
        run: () => [1e-20, 1e-12, 1, 1e12, 1e20].map((scale) =>
            computeRref([[scale, 2 * scale], [3 * scale, 4 * scale]]).toArray()
        ),
        verify: (results) => {
            for (const rows of results) {
                for (let row = 0; row < 2; row++) {
                    for (let column = 0; column < 2; column++) {
                        assert.ok(Math.abs(rows[row][column] - (row === column ? 1 : 0)) < 1e-9);
                    }
                }
            }
        }
    },
    {
        name: 'Invalid matrix syntax returns a friendly error',
        run: () => solver.solveMatrixExpression('[1, 2; 3] + [1, 2; 3, 4]'),
        verify: (result) => {
            assert.strictEqual(result.success, false);
            assert.ok(result.error.includes('same number of columns'));
        }
    }
];

function main() {
    console.log('=== RUNNING MATRIX TESTS ===\n');

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
        console.error(`\n${failures} matrix test(s) failed.`);
        process.exit(1);
    }

    console.log('\nAll matrix tests passed.');
}

main();
