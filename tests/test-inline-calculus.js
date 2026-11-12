const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');
const math = require('../src/math');
const solver = require('../src/solver');
const { preprocessCalculusHelpers } = require('../src/utils');
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

    const probeCode = [
        "const math = require('./src/math');",
        "const evaluate = (n, x) => math.evaluate('polygamma(n, x)', { n, x });",
        'console.log(JSON.stringify({',
        '  farFirst: evaluate(1, -1000000000.5),',
        '  farSecond: evaluate(2, -1000.25),',
        '  farThird: evaluate(3, -1001.25),',
        '  farDigamma: evaluate(0, -1000000000.5),',
        '  pole: Number.isNaN(evaluate(1, -1)),',
        '  hugeOrder: Number.isNaN(evaluate(1000000000, 1)),',
        '  infiniteArgument: Number.isNaN(evaluate(1, -Infinity))',
        '}));'
    ].join('\n');
    const polygammaProbe = spawnSync(process.execPath, ['-e', probeCode], {
        cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 10000
    });
    assert.ifError(polygammaProbe.error);
    assert.strictEqual(polygammaProbe.status, 0, polygammaProbe.stderr);
    const polygammaValues = JSON.parse(polygammaProbe.stdout);
    approxEqual(polygammaValues.farFirst, Math.PI ** 2 - 1e-9, 1e-8);
    approxEqual(polygammaValues.farSecond, 124.02510572269784, 1e-7);
    approxEqual(polygammaValues.farThird, 1558.5454565420496, 1e-6);
    approxEqual(polygammaValues.farDigamma, 20.723265837946414, 1e-8);
    assert(polygammaValues.pole && polygammaValues.hugeOrder && polygammaValues.infiniteArgument);
    console.log('PASS: Polygamma handles extreme inputs without blocking');

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

    const rawWindowsPath = String.raw`C:\temp\value`;
    assert.strictEqual(
        preprocessCalculusHelpers(`deriv[${rawWindowsPath}, vars:x]`),
        `deriv(${JSON.stringify(rawWindowsPath)}, ${JSON.stringify('vars:x')})`
    );
    console.log('PASS: Bracket helper preprocessing preserves backslashes in generated string literals');

    // Bracket notation tests (quote-free deriv[...] and integ[...])
    approxEqual(
        math.evaluate('deriv[x^2 + y^2 = 4, dep:y, x]', { x: 1, y: Math.sqrt(3) }),
        -1 / Math.sqrt(3),
        1e-3
    );
    console.log('PASS: Quote-free deriv[...] bracket notation evaluates numerically');

    approxEqual(math.evaluate('deriv[X^2, X, at:{X:3}]'), 6, 1e-6);
    approxEqual(math.evaluate('integ[T, T:[0,1]]'), 0.5, 1e-6);
    console.log('PASS: Inline assignments and ranges preserve variable case');
    assert.throws(() => math.evaluate('phi+1', {}));
    assert.throws(() => math.evaluate('E+1', {}));
    approxEqual(math.evaluate('phi+E', { phi: 3, E: 2 }), 5, 1e-9);
    console.log('PASS: Variable names do not silently fall back to mathjs constants');
    assert.throws(() => math.evaluate('integ[x,x:[0,1],x:[0,2]]'), /Duplicate range/);
    assert.throws(() => math.evaluate('deriv[x^2,vars:{x},vars:{y}]'), /Duplicate vars/);
    assert.throws(() => math.evaluate('deriv[x^2,x,at:{x:1,x:2}]'), /Duplicate assignment/);
    console.log('PASS: Inline helpers reject duplicate options');
    approxEqual(math.evaluate('integ[x^2+y^2,kind:line,param:{cos(t),sin(t)},t:[0,2*pi]]'), 2 * Math.PI, 1e-3);
    approxEqual(math.evaluate('integ[u*v*w,kind:volume,u:[0,1],v:[0,2],w:[0,3]]'), 4.5, 1e-3);
    console.log('PASS: Inline line and volume integrals match their symbolic forms');

    approxEqual(
        math.evaluate('integ[x^2 + y^2, x:[0, 1], y:[0, 2]]'),
        10 / 3,
        5e-3
    );
    console.log('PASS: Quote-free integ[...] bracket notation evaluates numerically');

    assert.throws(
        () => math.evaluate('integ[sin(x), x, 0, pi]'),
        /Definite integ syntax no longer accepts positional bounds/
    );
    console.log('PASS: Positional definite integ[...] syntax is rejected');

    console.log('--- INLINE CALCULUS TESTS PASSED ---');
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
