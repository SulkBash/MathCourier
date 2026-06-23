const solver = require('../src/solver');

const testCases = [
    // 1. Differentiation tests (Pure JS and Fallback)
    { type: 'diff', input: 'x^2 * sin(x)' },
    { type: 'diff', input: 'u^3 - u * y vars:u' },
    { type: 'diff', input: 'sin(t) vars:t' },
    { type: 'diff', input: 'erf(x) vars:x' }, // Should trigger SymPy fallback as mathjs does not support erf
    { type: 'diff', input: 'besselj(2, z) vars:z' }, // Should trigger SymPy fallback
    { type: 'diff', input: 'x^3 * y^2 vars:{x:2, y}' }, // Mixed partial higher order
    { type: 'diff', input: 'x^4 vars:{x:3}' }, // Single variable higher order
    { type: 'diff', input: 'x^2 * y vars:{x, y}' }, // Mixed partial first order

    // 2. Integration tests (SymPy)
    { type: 'int', input: 'sin(x)' },
    { type: 'int', input: 'x^2 vars:x' },
    { type: 'int', input: 'sin(x) x:[0, pi]' },
    { type: 'int', input: 'exp(-x^2) x:[0, inf]' },
    { type: 'int', input: 'sin(cos(x)) x:[0, 1]' }, // unevaluated symbolically, falls back to numerical
    { type: 'int', input: 'x^2 + y vars:x' }, // parameters
    { type: 'int', input: 'x * y vars:{x, y}' }, // Double indefinite
    { type: 'int', input: 'x^2 + y^2 x:[0, 1] y:[0, 2]' }, // Double definite
    { type: 'int', input: 'x * y * z x:[0, 1] y:[0, 1] z:[0, 1]' }, // Triple definite
    { type: 'int', input: 'x^3 / (exp(x) - 1) x:[0, inf]' }, // Planck/Thermodynamic integral (requires SciPy fallback for inf limit)
    { type: 'int', input: 'ln(sin(x)) x:[0, pi/2]' }, // Log-sine integral
    { type: 'int', input: '1 kind:volume x:[0, 1] y:[0, 1-x] z:[0, 1-x-y]' }, // Tetrahedron volume with variable limits

    // 3. Vector / multivariable field integrals
    { type: 'int', input: '(-y, x) kind:line param:{cos(t), sin(t)} t:[0, 2*pi]' },
    { type: 'int', input: 'x^2 + y^2 kind:line param:{cos(t), sin(t)} t:[0, 2*pi]' },
    { type: 'int', input: 'exp(sin(x^2)) kind:line param:{t, 0} t:[0, 1]' }, // Numeric fallback
    { type: 'int', input: '(0, 0, z) kind:surface param:{sin(u)*cos(v), sin(u)*sin(v), cos(u)} u:[0, pi] v:[0, 2*pi]' },
    { type: 'int', input: '1 kind:surface param:{u, v, 0} u:[0, 1] v:[0, 1]' },
    { type: 'int', input: 'x*y*z kind:volume x:[0, 1] y:[0, 2] z:[0, 3]' }
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
