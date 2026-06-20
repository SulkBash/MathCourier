const solver = require('../src/solver');

const testCases = [
    // 1. Differentiation tests (Pure JS and Fallback)
    { type: 'diff', input: 'x^2 * sin(x)' },
    { type: 'diff', input: 'u^3 - u * y, u' },
    { type: 'diff', input: 'sin(t) t' },
    { type: 'diff', input: 'erf(x) x' }, // Should trigger SymPy fallback as mathjs does not support erf
    { type: 'diff', input: 'besselj(2, z), z' }, // Should trigger SymPy fallback
    { type: 'diff', input: 'x^3 * y^2, x, 2, y' }, // Mixed partial higher order
    { type: 'diff', input: 'x^4, x, 3' }, // Single variable higher order
    { type: 'diff', input: 'x^2 * y, x, y' }, // Mixed partial first order

    // 2. Integration tests (SymPy)
    { type: 'int', input: 'sin(x)' },
    { type: 'int', input: 'x^2 x' },
    { type: 'int', input: 'sin(x) x 0 pi' },
    { type: 'int', input: 'exp(-x^2) x 0 inf' },
    { type: 'int', input: 'sin(cos(x)) x 0 1' }, // unevaluated symbolically, falls back to numerical
    { type: 'int', input: 'x^2 + y, x' }, // parameters
    { type: 'int', input: 'x * y, x, y' }, // Double indefinite
    { type: 'int', input: 'x^2 + y^2, x, 0, 1, y, 0, 2' }, // Double definite
    { type: 'int', input: 'x * y * z, x, 0, 1, y, 0, 1, z, 0, 1' } // Triple definite
];

async function runTests() {
    console.log('=== RUNNING CALCULUS SOLVER TESTS ===\n');

    for (let i = 0; i < testCases.length; i++) {
        const test = testCases[i];
        console.log(`Test ${i + 1} (${test.type.toUpperCase()}): "${test.input}"`);
        
        try {
            let result;
            if (test.type === 'diff') {
                result = await solver.solveDerivative(test.input);
            } else {
                result = await solver.solveIntegral(test.input);
            }

            if (result.success) {
                console.log('Success!');
                console.log('LaTeX:\n' + result.latex);
            } else {
                console.log('Failed:', result.error);
            }
        } catch (err) {
            console.error('Unhandled test exception:', err);
        }
        console.log('\n---------------------------------------\n');
    }
}

runTests();
