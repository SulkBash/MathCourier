const assert = require('assert');
const math = require('../src/math');
const renderer = require('../src/renderer');
const { solveCurvilinear } = require('../src/solver/curvilinear');
const { solveOde } = require('../src/solver/ode');
const { solvePde } = require('../src/solver/pde');
const { analyze2dPlot } = require('../src/plot-semantics');
const { _internals: plotInternals } = require('../src/renderer/plot');

// Exercise the actual command router and solvers without requiring a browser.
renderer.render = async (latex) => ({ success: true, latex });
renderer.renderPlot = async (body, options) => ({ success: true, body, options });
const handleSolveCommand = require('../src/commands/solve');
const handlePlotCommand = require('../src/commands/plot');

const cases = [
    ['Two-sided limit', 'limit[sin(x)/x, x, 0]', ['&= 1']],
    ['A missing two-sided limit reports both sides', 'limit[1/x, x, 0]', ['-\\infty', '\\infty', 'does not exist']],
    ['One-sided limit', 'limit[1/x, x, 0] dir:left', ['-\\infty']],
    ['One-sided limit respects assumptions', 'limit[1/x, x, 0] dir:right assume:{x>0}', ['\\infty', 'x>0']],
    ['Taylor series includes its remainder', 'series[sin(x), x, 0, 5]', ['\\frac{x^{3}}{6}', 'O\\left(x^{5}\\right)']],
    ['Laplace transform reports convergence and assumptions', 'laplace[exp(-a*t), t, s] assume:{a>0}', ['\\frac{1}{a + s}', '\\operatorname{Re}', 'a>0']],
    ['Laplace transform keeps a symbolic convergence plane', 'laplace[exp(-a*t), t, s]', ['\\operatorname{re}', '\\operatorname{Re}']],
    ['Inverse Laplace transform', 'invlaplace[1/(s+1), s, t]', ['e^{- t}', '\\theta']],
    ['Fourier cycles convention', 'fourier[exp(-t^2), t, w]', ['\\pi^{2} w^{2}', '2\\pi i']],
    ['Fourier angular convention', 'fourier[exp(-t^2), t, w] convention:angular', ['\\frac{w^{2}}{4}', 'e^{-i']],
    ['Inverse angular Fourier normalization', 'invfourier[sqrt(pi)*exp(-w^2/4), w, t] convention:angular', ['e^{- t^{2}}', '1/(2\\pi)']],
    ['Unit conversion', 'convert[5*km, m]', ['5000', '\\text{m}']],
    ['Imperial unit conversion remains exact', 'convert[3*inch, cm]', ['\\frac{381', '50}']],
    ['Derived-unit conversion', 'convert[N, kg*m/s^2]', ['\\text{kg}', '\\text{s}^{2}']],
    ['Dimensional analysis', 'dimension[N*m]', ['\\mathrm{L}^{2}', '\\mathrm{M}', '\\mathrm{T}^{-2}']],
    ['Real equation domain', 'x^2+1=0 domain:real', ['No solution', '\\mathbb{R}']],
    ['Complex equation domain', 'x^2+1=0 domain:complex', ['- i, i', '\\mathbb{C}']],
    ['Uppercase ranges constrain the uppercase variable', 'T^2=4 vars:T T:[0,3]', ['T = 2', 'T\\in \\left[0, 3\\right]']],
    ['Multi-letter symbols work with the symbolic backend', 'xy=4 domain:real', ['xy = 4']],
    ['A multi-letter limit variable is a single symbol', 'limit[sin(xy)/xy,xy,0]', ['&= 1']],
    ['Uppercase integration bounds preserve their variable', 'integ[T,T:[0,1]]', ['\\frac{1}{2}']],
    ['Uppercase derivative assignments preserve their variable', 'deriv[X^2,X,at:{X:3}]', ['&= 6']],
    ['Scalar line integrals use the parametrized arc length', 'integ[x^2+y^2, kind:line, param:{cos(t),sin(t)}, t:[0,2*pi]]', ['&= 2 \\pi']],
    ['Volume integrals honor named variables', 'integ[u*v*w, kind:volume, u:[0,1], v:[0,2], w:[0,3]]', ['\\frac{9}{2}']],
    ['Default symbolic solving retains real and complex roots', 'x^3-1=0', ['\\sqrt{3} i', 'Default domain', '\\mathbb{C}']],
    ['The imaginary unit agrees across backends', 'x=i domain:complex', ['x = i']],
    ['A real assumption changes simplification', 'sqrt(x^2) assume:{x:real}', ['\\sqrt{x^{2}}', '\\left|{x}\\right|', '\\mathbb{R}']],
    ['Symbolic real roots retain the real-domain intersection', 'x^2=a vars:x domain:real', ['\\mathbb{R} \\cap', '\\sqrt{a}']],
    ['Cancelled parameter denominators remain visible', '(a*x)/a=0 vars:x', ['x = 0', 'Input requires', 'a \\neq 0']],
    ['Positive parameter makes the integral converge', 'integ[exp(-a*x), x:[0, inf]] assume:{a>0}', ['\\frac{1}{a}', 'a>0']],
    ['Unresolved integral cases remain visible', 'integ[exp(-a*x), x:[0, inf]]', ['otherwise', 'unevaluated']],
    ['Parameterized linear equations include the degenerate case', 'a*x=0 vars:x', ['a \\neq 0', 'a = 0', '\\mathbb{C}']],
    ['Unresolved nonlinear parameter cases are labeled', 'a*x^2=0 vars:x', ['Partial solution']],
    ['Parameterized cubic formulas disclose exceptional cases', 'x^3+a*x+b=0 vars:x', ['Partial solution']],
    ['A cubic special case respects zero assumptions', 'x^3+a*x+b=0 vars:x assume:{a=0,b=0}', ['x = 0', 'a=0', 'b=0']],
    ['Parameterized systems report uncertain completeness', 'a*x=0; y=1 vars:{x,y}', ['Partial solution']],
    ['Transcendental systems report uncertain completeness', 'sin(x)=0; y=x vars:{x,y}', ['Partial solution']],
    ['Coordinate names and basis are displayed', 'grad[r^2*sin(theta)] coords:cylindrical', ['Cylindrical', '\\hat{\\mathbf e}', 'Coordinate domain']],
    ['Outer Cartesian coordinate order is honored', 'grad[x^2+y^2] vars:{y,x}', ['f(y, x)', '2\\cdot y, 2\\cdot x']],
    ['Phi is inferred as a coordinate rather than a built-in constant', 'grad[phi^2]', ['f(phi)', '2\\cdot\\phi']],
    ['Spherical divergence', 'div[(r, 0, 0)] coords:spherical', ['Spherical', '\\nabla\\cdot\\mathbf F &= 3']],
    ['Explicit Cartesian coordinates', 'grad[x^2+y^2] coords:cartesian', ['Cartesian coordinates']]
];

const failures = [
    ['Non-convergent Fourier transform', 'fourier[cos(t), t, w]', 'convergence'],
    ['Fourier input must span the real line', 'fourier[exp(-t^2), t, w] assume:{t>0}', 'real line'],
    ['Laplace input cannot be restricted to negative values', 'laplace[exp(-t), t, s] assume:{t<0}', 'nonnegative'],
    ['Inaccessible limit side', 'limit[1/x, x, 0] dir:left assume:{x>0}', 'dir:right'],
    ['Non-real symbolic limit point', 'limit[x, x, a]', 'must be real'],
    ['Incompatible units', 'convert[m, s]', 'incompatible'],
    ['Inconsistent dimensional addition', 'dimension[m+s]', 'different dimensions'],
    ['Conflicting assumptions', 'x^2=1 assume:{x>0,x<0}', 'Conflicting'],
    ['Zero parameter denominators are rejected', '(a*x)/a=0 vars:x assume:{a=0}', 'zero denominator'],
    ['Function names cannot be redefined as assumptions', 'sin(x)=0 assume:{sin:real}', 'conflicts'],
    ['Unsupported parameter constraint', 'x^2=1 assume:{x>2}', 'assumptions'],
    ['Inapplicable option is rejected', 'limit[sin(x)/x, x, 0] x:[0,1]', 'not supported'],
    ['A range cannot silently target a different variable', 'T^2=4 vars:T t:[0,3]', 'does not match'],
    ['Absent variables explain the multiplication rule', 'PV=nRT vars:T', 'use *'],
    ['Inapplicable equation option is rejected', 'x=1 kind:vector', 'not supported'],
    ['Inapplicable vector option is rejected', 'grad[x^2] kind:vector', 'not supported'],
    ['Duplicate integration ranges are rejected', 'integ[x,x:[0,1],x:[0,2]]', 'duplicate range'],
    ['Duplicate derivative variable options are rejected', 'deriv[x^2,vars:{x},vars:{y}]', 'duplicate vars'],
    ['Duplicate derivative assignments are rejected', 'deriv[x^2,x,at:{x:1,x:2}]', 'duplicate assignment'],
    ['Irrelevant integral parametrizations are rejected', 'integ[x,x:[0,1],param:{t}]', 'param'],
    ['Assumptions are not silently ignored for ODEs', 'dy/dx=-y ic:{y(0)=1} assume:{x:real}', 'not yet supported']
];

function near(actual, expected) {
    assert.ok(Math.abs(actual - expected) < 1e-8, 'expected ' + expected + ', got ' + actual);
}

async function run() {
    console.log('=== RUNNING SCIENTIFIC SOLVER TESTS ===');
    for (const [name, input, expected] of cases) {
        const result = await handleSolveCommand(input);
        assert.strictEqual(result.success, true, name + ': ' + result.error);
        for (const text of expected) assert.ok(result.latex.includes(text), name + ': missing ' + text + '\n' + result.latex);
        console.log('PASS: ' + name);
    }
    for (const [name, input, expected] of failures) {
        const result = await handleSolveCommand(input);
        assert.strictEqual(result.success, false, name + ' should fail');
        assert.ok(String(result.error).toLowerCase().includes(expected.toLowerCase()), name + ': ' + result.error);
        console.log('PASS: ' + name);
    }
    const upperPlot = await handlePlotCommand('sin(T) T:[0,3]');
    assert.strictEqual(upperPlot.success, true, upperPlot.error);
    assert.deepStrictEqual(upperPlot.options.labeledDomains.T, [0, 3]);
    assert.strictEqual(upperPlot.options.labeledDomains.t, undefined);
    console.log('PASS: Plot ranges preserve uppercase parameter names');
    const semantics = analyze2dPlot('xy^2', { labeledDomains: { xy: [1, 2] } });
    assert.strictEqual(semantics.independentVar, 'xy');
    const sampled = plotInternals.parseSingleExpression('xy^2', {
        semanticMode: true, semantics, xDomain: [1, 2], yDomain: [0, 5]
    });
    near(sampled.data[0].y, 1);
    near(sampled.data[sampled.data.length - 1].y, 4);
    assert.strictEqual(analyze2dPlot('sin(T)', { labeledDomains: { T: [0, 3] } }).independentVar, 'T');
    assert.strictEqual(analyze2dPlot('sin(phi)', { labeledDomains: { phi: [0, 3] } }).independentVar, 'phi');
    console.log('PASS: Plot sampling keeps multi-letter and uppercase variables intact');
    for (const input of ['sin(x) zlim:[-1,1]', 'sin(x) ic:{y(0)=1}', 'sin(x),cos(x) vars:{x}']) {
        const result = await handlePlotCommand(input);
        assert.strictEqual(result.success, false, input + ' should reject an unused option');
        console.log('PASS: Plot rejects an unused option in ' + input);
    }
    const odeDisplay = await solveOde('dy/dx=-y ic:{y(0)=1} y:[-2,2]');
    assert.strictEqual(odeDisplay.success, true, odeDisplay.error);
    assert.deepStrictEqual(odeDisplay.yDomain, [-2, 2]);
    assert.ok(odeDisplay.xDomain[0] < -2 && odeDisplay.xDomain[1] > 2);
    const badOdeRange = await solveOde('dy/dx=-y ic:{y(0)=1} T:[0,2]');
    assert.strictEqual(badOdeRange.success, false);
    assert.match(badOdeRange.error, /T.*does not match/);
    console.log('PASS: ODE ranges apply to their named variable');
    const phase = await solveOde('dx/dt=-y; dy/dt=x ic:{x(0)=1; y(0)=0} phase:{x,y} t:[0,2] x:[-2,2] y:[-3,3]');
    assert.strictEqual(phase.success, true, phase.error);
    assert.deepStrictEqual(phase.xDomain, [-2, 2]);
    assert.deepStrictEqual(phase.yDomain, [-3, 3]);
    console.log('PASS: Phase-portrait ranges apply to the correct axes');
    const pdeText = 'du/dt=d2u/dx2 ic:{u(x,0)=sin(x)} bc:{u(0,t)=0; u(pi,t)=0}';
    const pde = await solvePde(pdeText + ' t:[0,0.2]');
    assert.strictEqual(pde.success, true, pde.error);
    assert.strictEqual(pde.spatial_variable, 'x');
    assert.strictEqual(pde.temporal_variable, 't');
    assert.strictEqual(pde.dependent_variable, 'u');
    near(pde.xDomain[0], 0);
    near(pde.xDomain[1], Math.PI);
    assert.deepStrictEqual(pde.tDomain, [0, 0.2]);
    const badPdeRange = await solvePde(pdeText + ' T:[0,0.2]');
    assert.strictEqual(badPdeRange.success, false);
    assert.match(badPdeRange.error, /T.*does not match/);
    console.log('PASS: PDE time and spatial ranges cannot be confused');

    const vectors = [
        ['grad', 'r^2*sin(theta)', 'cylindrical', { r: 2, theta: Math.PI / 6, z: 0 }, [2, Math.sqrt(3), 0]],
        ['lap', 'r^2', 'cylindrical', { r: 2, theta: 1, z: 0 }, 4],
        ['div', '(r, 0, 0)', 'cylindrical', { r: 2, theta: 1, z: 0 }, 2],
        ['curl', '(0, r, 0)', 'cylindrical', { r: 2, theta: 1, z: 0 }, [0, 0, 2]],
        ['grad', 'r^2', 'spherical', { r: 2, theta: 1, phi: 1 }, [4, 0, 0]],
        ['lap', 'r^2', 'spherical', { r: 2, theta: 1, phi: 1 }, 6],
        ['div', '(r, 0, 0)', 'spherical', { r: 2, theta: 1, phi: 1 }, 3],
        ['curl', '(0, 0, r*sin(theta))', 'spherical', { r: 2, theta: Math.PI / 3, phi: 1 }, [1, -Math.sqrt(3), 0]]
    ];
    for (const [operator, expression, coords, scope, expected] of vectors) {
        const result = solveCurvilinear(operator, expression, coords);
        assert.strictEqual(result.success, true, result.error);
        const actual = Array.isArray(result.result)
            ? result.result.map((part) => math.evaluate(part, scope))
            : math.evaluate(result.result, scope);
        if (Array.isArray(expected)) expected.forEach((value, index) => near(actual[index], value));
        else near(actual, expected);
        console.log('PASS: ' + coords + ' ' + operator + ' evaluates correctly');
    }
    const renamed = solveCurvilinear('grad', 'rho^2, vars:{rho, alpha, beta}', 'spherical');
    assert.strictEqual(renamed.success, true, renamed.error);
    assert.deepStrictEqual(renamed.variables, ['rho', 'alpha', 'beta']);
    near(math.evaluate(renamed.result[0], { rho: 3, alpha: 1, beta: 1 }), 6);
    assert.ok(renamed.latex.includes('\\alpha\\text{ polar; }\\beta\\text{ azimuth}'));
    console.log('PASS: Coordinate names preserve the documented convention');
    for (const coords of ['cylindrical', 'spherical']) {
        const source = coords === 'cylindrical' ? 'r^2*sin(theta)+z^2' : 'r^2*sin(theta)*cos(phi)';
        const gradient = solveCurvilinear('grad', source, coords);
        assert.strictEqual(gradient.success, true, gradient.error);
        const curl = solveCurvilinear('curl', '(' + gradient.result.join(',') + ')', coords);
        assert.strictEqual(curl.success, true, curl.error);
        const scope = { r: 2, theta: 0.8, phi: 0.6, z: 1 };
        curl.result.forEach((component) => near(math.evaluate(component, scope), 0));
        console.log('PASS: Curl of a gradient vanishes in ' + coords + ' coordinates');
    }
    console.log('=== SCIENTIFIC SOLVER TESTS PASSED ===');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
