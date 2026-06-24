const assert = require('assert');
const math = require('../src/math');
const solver = require('../src/solver');
const { extractVariables } = require('../src/solver/equations');
const { extractExpressionVariables } = require('../src/plot-semantics');

function approxEqual(actual, expected, tolerance = 1e-3) {
    assert(
        Math.abs(actual - expected) <= tolerance,
        `Expected ${expected} +/- ${tolerance}, got ${actual}`
    );
}

async function run() {
    console.log('--- STARTING INLINE CALCULUS TESTS ---');

    approxEqual(
        math.evaluate('deriv("x^3*y^2", "vars:{x:2, y}")', { x: 2, y: 3 }),
        72,
        1e-3
    );
    console.log('PASS: Higher-order mixed inline derivative evaluates numerically');

    approxEqual(
        math.evaluate('integ("sin(t)", "vars:t")', { t: Math.PI }),
        2,
        5e-3
    );
    console.log('PASS: Inline antiderivative-style integral uses the current variable as the upper bound');

    approxEqual(
        math.evaluate('integ("x^2 + y^2", "x:[0, 1]", "y:[0, 2]")'),
        10 / 3,
        5e-3
    );
    console.log('PASS: Inline double definite integral evaluates correctly');

    approxEqual(
        math.evaluate('integ("(-y, x)", "kind:line", "param:{cos(t), sin(t)}", "t:[0, 2*pi]")'),
        2 * Math.PI,
        5e-2
    );
    console.log('PASS: Inline line integral evaluates correctly');

    approxEqual(
        math.evaluate('integ("(0, 0, z)", "kind:surface", "param:{sin(u)*cos(v), sin(u)*sin(v), cos(u)}", "u:[0, pi]", "v:[0, 2*pi]")'),
        (4 * Math.PI) / 3,
        8e-2
    );
    console.log('PASS: Inline surface integral evaluates correctly');

    approxEqual(
        math.evaluate('integ("x*y*z", "kind:volume", "x:[0, 1]", "y:[0, 2]", "z:[0, 3]")'),
        9 / 2,
        5e-3
    );
    console.log('PASS: Inline volume integral evaluates correctly');

    approxEqual(
        math.evaluate('deriv("x^2 + y^2 = 4", "dep:y", "x")', { x: 0, y: 2 }),
        0,
        1e-3
    );
    approxEqual(
        math.evaluate('deriv("x^2 + y^2 = 4", "dep:y", "x")', { x: 1, y: Math.sqrt(3) }),
        -1 / Math.sqrt(3),
        1e-3
    );
    console.log('PASS: Inline implicit derivative evaluates numerically');

    const equationVars = extractVariables(math.parse('deriv("x^3*y^2", "vars:{x:2, y}") - 1'));
    assert.deepStrictEqual(equationVars.sort(), ['x', 'y']);
    console.log('PASS: Equation solving sees helper dependencies hidden inside quoted helper args');

    const plotVars = extractExpressionVariables('integ("sin(t)", "vars:t") + 1');
    assert(plotVars.includes('t'));
    console.log('PASS: Plot semantics sees inline helper dependencies');

    // Bracket notation tests (quote-free deriv[...] and integ[...])
    approxEqual(
        math.evaluate('deriv[x^2 + y^2 = 4, dep:y, x]', { x: 1, y: Math.sqrt(3) }),
        -1 / Math.sqrt(3),
        1e-3
    );
    console.log('PASS: Quote-free deriv[...] bracket notation evaluates numerically');

    approxEqual(
        math.evaluate('integ[x^2 + y^2, x:[0, 1], y:[0, 2]]'),
        10 / 3,
        5e-3
    );
    console.log('PASS: Quote-free integ[...] bracket notation evaluates numerically');

    console.log('--- INLINE CALCULUS TESTS PASSED ---');
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
