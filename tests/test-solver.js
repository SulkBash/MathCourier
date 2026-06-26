const assert = require('assert');
const solver = require('../src/solver');

const cases = [
    {
        name: 'Linear system',
        input: 'x + y = 5; x - y = 1',
        expectSuccess: true,
        latexIncludes: ['x = 3', 'y = 2']
    },
    {
        name: 'Linear system prefers exact fractions',
        input: 'x + y + z = 6; 2*x - y + z = 3; x + 2*y - z = 3',
        expectSuccess: true,
        latexIncludes: ['x = \\frac{9}{7}', 'y = \\frac{15}{7}', 'z = \\frac{18}{7}'],
        latexExcludes: ['1.28571429', '2.14285714', '2.57142857']
    },
    {
        name: 'Quadratic equation',
        input: 'x^2 - 5*x + 6 = 0',
        expectSuccess: true,
        latexIncludes: ['x_1 = 3', 'x_2 = 2']
    },
    {
        name: 'Complex roots',
        input: 'x^2 + 1 = 0',
        expectSuccess: true,
        latexIncludes: ['x_1 = 0 + i', 'x_2 = 0 - i']
    },
    {
        name: 'Cubic equation',
        input: 'x^3 - 6*x^2 + 11*x - 6 = 0',
        expectSuccess: true,
        latexIncludes: ['x_1 = 1', 'x_2 = 3', 'x_3 = 2']
    },
    {
        name: 'Linear equation',
        input: '3*x + 6 = 0',
        expectSuccess: true,
        latexIncludes: ['x = -2']
    },
    {
        name: 'Transcendental numeric fallback',
        input: 'cos(x) - x = 0',
        expectSuccess: true,
        latexIncludes: ['x \\approx 0.7390851332']
    },
    {
        name: 'Implicit zero equation',
        input: 'x^2 - 4',
        expectSuccess: true,
        latexIncludes: ['x_1 = 2', 'x_2 = -2']
    },
    {
        name: 'Tautology',
        input: '2 + 2 = 4',
        expectSuccess: true,
        latexIncludes: ['Tautology (always true)']
    },
    {
        name: 'Contradiction',
        input: '2 + 2 = 5',
        expectSuccess: true,
        latexIncludes: ['Contradiction (no solution)']
    },
    {
        name: 'Logarithmic exact solve',
        input: 'ln(x) - 1 = 0',
        expectSuccess: true,
        latexIncludes: ['x = e']
    },
    {
        name: 'Exponential exact solve',
        input: 'exp(x) - 2 = 0',
        expectSuccess: true,
        latexIncludes: ['x = \\log{\\left(2 \\right)}']
    },
    {
        name: 'Derivative helper inside equation',
        input: 'deriv("x^3", "x", x) - 12 = 0',
        expectSuccess: true,
        latexIncludes: ['x \\in \\left\\{-2, 2\\right\\}']
    },
    {
        name: 'Integral helper inside equation',
        input: 'integ("t^2", "t:[0, x]") - 9 = 0',
        expectSuccess: true,
        latexIncludes: ['\\int\\limits_{0}^{x} t^{2}\\, dt - 9 = 0', 'x = 3']
    },
    {
        name: 'Positional definite integ helper syntax is rejected',
        input: 'integ("t^2", "t", 0, x) - 9 = 0',
        expectSuccess: false,
        errorIncludes: ['Definite integ syntax no longer accepts positional bounds']
    },
    {
        name: 'Variable isolation for c',
        input: 'E = m * c^2 vars:c',
        expectSuccess: true,
        latexIncludes: ['\\implies c \\in', '\\sqrt{\\frac{E}{m}}'],
        latexExcludes: ['\\approx']
    },
    {
        name: 'Variable isolation for temperature',
        input: 'PV = nRT vars:T',
        expectSuccess: true,
        latexIncludes: ['T = \\frac{P V}{R n}']
    },
    {
        name: 'Quadratic isolation',
        input: 'y = a*x^2 + b*x + c vars:x',
        expectSuccess: true,
        latexIncludes: ['\\implies x \\in', '\\sqrt{- 4 a c + 4 a y + b^{2}}']
    },
    {
        name: 'Trigonometric isolation',
        input: 'sin(theta) = x / r vars:theta',
        expectSuccess: true,
        latexIncludes: ['\\theta \\in', '\\operatorname{asin}{\\left(\\frac{x}{r} \\right)}']
    },
    {
        name: 'Pythagorean isolation',
        input: 'a^2 + b^2 = c^2 vars:a',
        expectSuccess: true,
        latexIncludes: ['a \\in', '\\sqrt{- b^{2} + c^{2}}']
    },
    {
        name: 'Periodic symbolic solution',
        input: 'sin(x) = 0',
        expectSuccess: true,
        latexIncludes: ['n \\in \\mathbb{Z}'],
        latexExcludes: ['\\approx']
    },
    {
        name: 'Exact irrational roots',
        input: 'x^2 - 2 = 0',
        expectSuccess: true,
        latexIncludes: ['x \\in \\left\\{- \\sqrt{2}, \\sqrt{2}\\right\\}'],
        latexExcludes: ['\\approx']
    },
    {
        name: 'Strict inequality',
        input: 'x^2 - 4 > 0',
        expectSuccess: true,
        latexIncludes: ['\\left(-\\infty, -2\\right) \\cup \\left(2, \\infty\\right)']
    },
    {
        name: 'Closed inequality interval',
        input: 'x^2 - 1 <= 0',
        expectSuccess: true,
        latexIncludes: ['x \\in \\left[-1, 1\\right]']
    },
    {
        name: 'Domain constrained sine solve',
        input: 'sin(x) = 0 x:[0, 2*pi]',
        expectSuccess: true,
        latexIncludes: ['x \\in \\left\\{0, \\pi, 2 \\pi\\right\\}']
    },
    {
        name: 'Domain constrained cosine solve',
        input: 'cos(x) = 0.5 x:[0, pi]',
        expectSuccess: true,
        latexIncludes: ['x = \\frac{\\pi}{3}'],
        latexExcludes: ['\\approx']
    },
    {
        name: 'Factor mode',
        input: 'x^2 - 5*x + 6 mode:factor',
        expectSuccess: true,
        latexIncludes: ['\\left(x - 3\\right) \\left(x - 2\\right)']
    },
    {
        name: 'Expand mode',
        input: '(x-1)^3 mode:expand',
        expectSuccess: true,
        latexIncludes: ['x^{3} - 3 x^{2} + 3 x - 1']
    },
    {
        name: 'Simplify mode',
        input: 'cos(x)^2 - sin(x)^2 mode:simplify',
        expectSuccess: true,
        latexIncludes: ['\\cos{\\left(2 x \\right)}']
    },
    {
        name: 'Calculus simplification mode',
        input: 'deriv[x^3, x] - integ[2*x, x] mode:simplify',
        expectSuccess: true,
        latexIncludes: ['\\frac{d}{d x} x^{3} - \\int 2 x\\, dx &= 2 x^{2}']
    },
    {
        name: 'Relational matrix equation uses symbolic backend',
        input: 'det([x, 1; 2, x]) = 0',
        expectSuccess: true,
        latexIncludes: ['x \\in \\left\\{- \\sqrt{2}, \\sqrt{2}\\right\\}'],
        latexExcludes: ['\\approx']
    },
    {
        name: 'Helpful error for unspecified target variable',
        input: 'PV = nRT',
        expectSuccess: false,
        errorIncludes: ['Multiple variables detected: P, R, T, V, n. Please specify vars:<variable>.']
    }
];

async function run() {
    console.log('=== RUNNING SOLVER TESTS ===');

    for (const testCase of cases) {
        const result = await solver.solveEquation(testCase.input);

        if (testCase.expectSuccess) {
            assert.strictEqual(result.success, true, `${testCase.name} should succeed: ${result.error || 'unknown error'}`);
            for (const snippet of testCase.latexIncludes || []) {
                assert(
                    result.latex.includes(snippet),
                    `${testCase.name} is missing expected latex snippet:\n${snippet}\n\nActual output:\n${result.latex}`
                );
            }
            for (const snippet of testCase.latexExcludes || []) {
                assert(
                    !result.latex.includes(snippet),
                    `${testCase.name} unexpectedly included latex snippet:\n${snippet}\n\nActual output:\n${result.latex}`
                );
            }
        } else {
            assert.strictEqual(result.success, false, `${testCase.name} should fail`);
            for (const snippet of testCase.errorIncludes || []) {
                assert(
                    String(result.error || '').includes(snippet),
                    `${testCase.name} is missing expected error snippet:\n${snippet}\n\nActual error:\n${result.error}`
                );
            }
        }

        console.log(`PASS: ${testCase.name}`);
    }

    console.log('=== SOLVER TESTS PASSED ===');
}

run().catch((error) => {
    console.error('Fatal solver test error:', error);
    process.exitCode = 1;
});
