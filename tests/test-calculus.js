const solver = require('../src/solver');

const testCases = [
    // 1. Differentiation tests (Pure JS and Fallback)
    { type: 'diff', input: 'x^2 * sin(x)' },
    { type: 'diff', input: 'u^3 - u * y, u' },
    { type: 'diff', input: 'sin(t) t' },
    { type: 'diff', input: 'erf(x) x' }, // Should trigger SymPy fallback as mathjs does not support erf
    { type: 'diff', input: 'besselj(2, z), z' }, // Should trigger SymPy fallback

    // 2. Integration tests (SymPy)
    { type: 'int', input: 'sin(x)' },
    { type: 'int', input: 'x^2 x' },
    { type: 'int', input: 'sin(x) x 0 pi' },
    { type: 'int', input: 'exp(-x^2) x 0 inf' },
    { type: 'int', input: 'sin(cos(x)) x 0 1' }, // unevaluated symbolically, falls back to numerical
    { type: 'int', input: 'x^2 + y, x' } // parameters
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
