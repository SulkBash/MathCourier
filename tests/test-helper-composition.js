const assert = require('assert');
const childProcess = require('child_process');
const originalSpawn = childProcess.spawn;
let subprocesses = 0;
childProcess.spawn = (...args) => {
    subprocesses++;
    return originalSpawn(...args);
};

const math = require('../src/math');
const renderer = require('../src/renderer');
renderer.render = async (latex) => ({ success: true, latex });
renderer.renderPlot = async (body, options) => ({ success: true, body, options });
renderer.renderPlot3d = renderer.renderPlot;
const solve = require('../src/commands/solve');
const plot = require('../src/commands/plot');
const { analyze2dPlot } = require('../src/plot-semantics');
const { _internals: plotInternals } = require('../src/renderer/plot');

function near(actual, expected) {
    assert.ok(Math.abs(actual - expected) < 1e-8, `expected ${expected}, got ${actual}`);
}

async function successful(input, fragments) {
    const result = await solve(input);
    assert.strictEqual(result.success, true, `${input}: ${result.error}`);
    for (const fragment of fragments) {
        assert.ok(result.latex.includes(fragment), `${input}: missing ${fragment}\n${result.latex}`);
    }
    console.log('PASS: ' + input);
}

async function rejected(input, fragment) {
    const result = await solve(input);
    assert.strictEqual(result.success, false, `${input} should fail`);
    assert.match(result.error.toLowerCase(), new RegExp(fragment.toLowerCase()));
    console.log('PASS: rejects ' + input);
}

async function run() {
    console.log('=== HELPER COMPOSITION TESTS ===');
    await successful('limit[sin(t*x)/t,t,0]+1', ['x + 1', '\\lim_{t\\to 0}']);
    await successful('2limit[sin(t)/t,t,0]+1', ['&= 3']);
    await successful('limit[sin(t*x)/t,t,0]=2 vars:x', ['x = 2', '\\lim_{t\\to 0}']);
    await successful('deriv[limit[sin(t*x)/t,t,0],x]', ['&= 1', '\\lim_{t\\to 0}']);
    await successful('limit[deriv[x*t,x],t,1]', ['&= 1']);
    await successful('limit[limit[sin(t*x)/t,t,0],x,2]', ['&= 2']);
    await successful('limit[abs(x)/x,x,0,dir:left]+2', ['&= 1', '\\to 0^-']);
    await successful('limit[abs(x)/x,x,0] dir:left mode:simplify', ['&= -1', '\\to 0^-']);
    await successful('limit[x,x,0]+limit[sin(t)/t,t,0]', ['&= 1', '\\lim_{t\\to 0}', '\\lim_{x\\to 0}']);
    await successful('series[sin(x),x,0,5]+1', ['1 + x', 'O\\left(x^{5}\\right)']);
    await successful('deriv[series[sin(x),x,0,5],x]', ['O\\left(x^{4}\\right)']);
    await successful('limit[series[sin(x),x,0,5],x,0]', ['&= 0']);
    await successful('fourier[exp(-t^2),t,w,convention:angular]+w', ['w^{2}}{4}', 'e^{-i']);
    await successful('fourier[exp(-abs(t)),t,w]=-1 vars:w', ['No solution', '\\mathbb{R}']);
    await successful('laplace[exp(-t),t,s]+1', ['\\operatorname{Re}', '> -1']);
    await successful('deriv[laplace[1,t,s],s,at:{s:2}]', ['\\frac{1}{4}', '\\operatorname{Re}']);
    await successful('integ[laplace[1,t,s],s:[1,2]]', ['\\log', '\\operatorname{Re}']);
    await successful('convert[convert[5*km,m],cm]', ['500000', '\\text{cm}']);
    await successful('dimension[convert[5*km,m]]', ['\\mathrm{L}']);
    await successful('grad[limit[sin(t*x)/t,t,0]+y] vars:{x,y}', ['\\nabla', '\\lim_{t\\to 0}']);
    await successful('grad[limit[sin(t*r^2)/t,t,0]] coords:cylindrical', ['Cylindrical', '2\\cdot r']);
    await successful('det([limit[sin(t)/t,t,0],2;3,4])', ['&= -2', '\\lim_{t\\to 0}']);
    await successful('eigen([limit[sin(t)/t,t,0],0;0,2])', ['\\lambda_{1} &= 1', '\\lambda_{2} &= 2']);

    await rejected('limit[1/x,x,0]+1', 'does not exist');
    await rejected('limit[1/x,x,0,dir:left]+limit[1/x,x,0,dir:right]', 'indeterminate');
    await rejected('limit[x,x,,0]', 'expects');
    await rejected('limit[1/x,x,0,dir:left] dir:right', 'inside or after');
    await rejected('limit[1/x,x,0,dir:left,dir:right]', 'duplicate dir');
    await rejected('fourier[cos(t),t,w]+1', 'convergence');
    await rejected('fourier[exp(-abs(t)),t,w]=-1 vars:w domain:complex', 'variables are real');
    await rejected('deriv[fourier[exp(-t^2),t,w],w,at:{w:i}]', 'real evaluation point');
    await rejected('series[sin(x),x,0,5]=0', 'remainder');
    await rejected('limit[series[sin(x),x,0,5],x,2]', 'expansion point');
    await rejected('laplace[series[exp(t),t,0,3],t,s]', 'series remainder');
    await rejected('laplace[1,t,s]=-1 vars:s', 'convergence condition');
    await rejected('limit[laplace[1,t,s],s,-1]', 'convergence region');
    await rejected('limit[laplace[exp(-a*t),t,s],a,-1]', 'convergence region');
    await rejected('deriv[laplace[1,t,s],s,at:{s:-1}]', 'convergence region');
    await rejected('deriv[laplace[exp(-a*t),t,s],a,at:{a:-1}]', 'convergence region');
    await rejected('integ[laplace[1,t,s],s:[-2,-1]]', 'convergence region');
    await rejected('integ[series[sin(x),x,0,5],x:[1,2]]', 'series remainder');
    await rejected('convert[5*km,m]+1', 'unit conversions');
    await rejected('dimension[m]+1', 'metadata');
    await rejected('eigen([limit[sin(t)/t,t,0],0;0,2]) mode:simplify', 'eigenvalue');
    await rejected('eigen([limit[sin(t)/t,t,0],0;0,2])=2', 'eigenvalue');
    await rejected('limit[__import__("os"),x,0]+1', 'invalid');
    await rejected('deriv[laplace[1,t,s],s,__import__("os")]', 'invalid');

    const before = subprocesses;
    const curve = await plot('limit[sin(t*x)/t,t,0]+limit[(1-cos(t))/t^2,t,0] x:[-2,2]');
    assert.strictEqual(curve.success, true, curve.error);
    assert.strictEqual(subprocesses - before, 1, 'all helper computations share one subprocess');
    near(math.evaluate(curve.body, { x: 2 }), 2.5);
    const semantics = analyze2dPlot(curve.body, { labeledDomains: curve.options.labeledDomains });
    const sampled = plotInternals.parseSingleExpression(curve.body, {
        semanticMode: true, semantics, xDomain: [-2, 2], yDomain: [-3, 3]
    });
    near(sampled.data[0].y, -1.5);
    near(sampled.data[sampled.data.length - 1].y, 2.5);
    assert.strictEqual(subprocesses - before, 1, 'sampling must not spawn Python');
    console.log('PASS: a plot expands multiple helpers once and samples their result');

    const derivative = await plot('deriv[limit[sin(t*x)/t,t,0],x] x:[-2,2]');
    assert.strictEqual(derivative.success, true, derivative.error);
    near(math.evaluate(derivative.body, { x: 2 }), 1);
    const series = await plot('series[sin(x),x,0,5] x:[-2,2]');
    assert.strictEqual(series.success, true, series.error);
    assert.strictEqual(series.options.seriesTruncated, true);
    near(math.evaluate(series.body, { x: 1 }), 5 / 6);
    const surface = await plot('limit[sin(t*x*y)/t,t,0] view:3d x:[-1,1] y:[-1,1]');
    assert.strictEqual(surface.success, true, surface.error);
    near(math.evaluate(surface.body, { x: 0.5, y: 0.5 }), 0.25);
    const validLaplace = await plot('laplace[exp(-t),t,s] s:[0,2]');
    assert.strictEqual(validLaplace.success, true, validLaplace.error);
    near(math.evaluate(validLaplace.body, { s: 1 }), 0.5);
    const inverseLaplace = await plot('invlaplace[1/(s+1),s,t] t:[-2,2]');
    assert.strictEqual(inverseLaplace.success, true, inverseLaplace.error);
    near(math.evaluate(inverseLaplace.body, { t: -1 }), 0);
    near(math.evaluate(inverseLaplace.body, { t: 0 }), 0.5);
    near(math.evaluate(inverseLaplace.body, { t: 1 }), Math.exp(-1));
    for (const input of ['laplace[exp(-t),t,s] s:[-2,2]', 'laplace[exp(-t),t,s]',
        'limit[1/x,x,0]+1 x:[-2,2]', 'fourier[cos(t),t,w] w:[-2,2]']) {
        const result = await plot(input);
        assert.strictEqual(result.success, false, input + ' should fail');
    }
    console.log('PASS: nested, 3D, series, and convergence-restricted plots');
    console.log('=== HELPER COMPOSITION TESTS PASSED ===');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => { childProcess.spawn = originalSpawn; });
