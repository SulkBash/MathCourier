const assert = require('assert');
const solver = require('../src/solver');

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
