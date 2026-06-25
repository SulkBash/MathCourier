const fs = require('fs');
const path = require('path');
const renderer = require('../src/renderer');

const OUTPUT_DIR = path.join(__dirname, '../test_output');

async function runTest(name, fn) {
    console.log(`\n${name}`);
    try {
        const result = await fn();
        if (result.success && result.data) {
            const filename = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '') + '.png';
            const out = path.join(OUTPUT_DIR, filename);
            fs.writeFileSync(out, Buffer.from(result.data, 'base64'));
            console.log(`  ok (${result.source}) -> ${out}`);
        } else if (result.success === false && result.expectFail) {
            console.log(`  ok (expected error): ${result.error}`);
        } else {
            console.error(`  FAIL: ${result.error}`);
        }
    } catch (err) {
        console.error(`  FAIL (exception): ${err.message}`);
    }
}

async function runTests() {
    console.log('--- STARTING RENDER TESTS ---');
    
    await renderer.initialize();
    console.log(`Renderer: ${renderer.isLocalReady() ? 'local' : 'fallback only'}`);
    
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

    await runTest('Gaussian integral', () =>
        renderer.render('\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}', true));

    await runTest('Mixed text + equation', () =>
        renderer.render(
            'Solving the quadratic equation:\nFor a quadratic of the form ax^2 + bx + c = 0, the roots are given by:\n$$\\displaystyle x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$',
            false));

    await runTest('Invalid LaTeX (expect error)', async () => {
        const res = await renderer.render('\\frac{a}{b', true);
        if (!res.success) return { ...res, expectFail: true };
        return { success: false, error: 'Expected failure but got success' };
    });

    await runTest('Chemfig benzene', () =>
        renderer.renderChem('\\chemfig{A-B*6(=-=-=-)}'));

    await runTest('TikZ circle', () =>
        renderer.renderTikz(`
\\draw[thick, fill=blue!10] (0,0) circle (1.5);
\\node[align=center] at (0,0) {TikZ\\\\Works!};
\\draw[->, red, very thick] (-2,2) -- (-0.2,0.2);
`));

    await runTest('Circuitikz diagram', () =>
        renderer.renderTikz(`
\\draw (0,0) to[R, l=$R$] (2,0)
      to[C, l=$C$] (2,2)
      to[L, l=$L$] (0,2)
      to[V, l=$V$] (0,0);
`));

    await runTest('Plot explicit sin*cos', () =>
        renderer.renderPlot('sin(x) * cos(x/2)', { xDomain: [-10, 10], yDomain: [-2, 2] }));

    await runTest('Plot multi explicit curves', () =>
        renderer.renderPlot('y = sin(x), y = cos(x), y = x/5', { xDomain: [-10, 10], yDomain: [-2, 2] }));

    await runTest('Plot multi mixed explicit and implicit curves', () =>
        renderer.renderPlot('y = x^2, x^2 + y^2 = 9', { xDomain: [-4, 4], yDomain: [-4, 4] }));

    await runTest('Plot implicit circle', () =>
        renderer.renderPlot('x^2 + y^2 = 1', { xDomain: [-1.5, 1.5], yDomain: [-1.5, 1.5] }));

    await runTest('Plot implicit elliptic curve', () =>
        renderer.renderPlot('y^2 = x^3 - x', { xDomain: [-2, 2], yDomain: [-2, 2] }));

    await runTest('Plot arctan equation', () =>
        renderer.renderPlot('arctan(x^3-x+y)=y^2', { xDomain: [-10, 10], yDomain: [-10, 10] }));

    await runTest('Plot invalid (expect error)', async () => {
        const res = await renderer.renderPlot('y = sin(x /');
        if (!res.success) return { ...res, expectFail: true };
        return { success: false, error: 'Expected failure but got success' };
    });

    await runTest('Plot vector field', () =>
        renderer.renderPlot('v(x,y)=(sin(x)/xy,cos(y)/xy)', { xDomain: [-2, 2], yDomain: [-2, 2] }));

    await runTest('Plot explicit vector field kind override', () =>
        renderer.renderPlot('(-y, x)', { xDomain: [-5, 5], yDomain: [-5, 5], kind: 'vector' }));

    await runTest('Plot ln(x)', () =>
        renderer.renderPlot('y = ln(x)', { xDomain: [-10, 10], yDomain: [-10, 10] }));

    await runTest('Plot derivative of x^3', () =>
        renderer.renderPlot('y = deriv("x^3", "x", x)', { xDomain: [-3, 3], yDomain: [-10, 10] }));

    await runTest('Plot integral of sin(t)', () =>
        renderer.renderPlot('y = integ("sin(t)", "t:[0, x]")', { xDomain: [-10, 10], yDomain: [-3, 3] }));

    await runTest('Plot laplacian of x^3', () =>
        renderer.renderPlot('y = lap("x^3")', { xDomain: [-3, 3], yDomain: [-20, 20] }));

    await runTest('Plot gradient field of x^2 + y^2', () =>
        renderer.renderPlot(
            'v(x,y) = (gradx("x^2 + y^2"), grady("x^2 + y^2"))',
            { xDomain: [-3, 3], yDomain: [-3, 3] }
        ));

    await runTest('Plot implicit gradient field of x^2 + y^2 (expect ambiguity error)', async () => {
        const res = await renderer.renderPlot(
            '(gradx("x^2 + y^2"), grady("x^2 + y^2"))',
            { xDomain: [-3, 3], yDomain: [-3, 3] }
        );
        if (!res.success) return { ...res, expectFail: true };
        return { success: false, error: 'Expected ambiguity failure but got success' };
    });

    await runTest('Plot parametric Lissajous curve', () =>
        renderer.renderPlot('(cos(3*t), sin(2*t))', { domains: [[0, 2*Math.PI]] }));

    await runTest('Plot polar cardioid', () =>
        renderer.renderPlot('r = 2 * (1 - cos(theta))', { domains: [[0, 2*Math.PI]] }));

    await runTest('Plot polar rose', () =>
        renderer.renderPlot('r = sin(4*theta)', { domains: [[0, 2*Math.PI]] }));

    await runTest('Plot implicit polar lemniscate', () =>
        renderer.renderPlot('r^2 = 9 * cos(2*theta)', { domains: [[-4, 4], [-4, 4]] }));

    await runTest('Plot multi-plot overlay parametric and polar', () =>
        renderer.renderPlot('(cos(t), sin(t)), r = 1.5', { domains: [[0, 2*Math.PI]] }));

    const handlePlotCommand = require('../src/commands/plot');
    await runTest('Plot command handle parametric Lissajous', () =>
        handlePlotCommand('(cos(3*t), sin(2*t)) kind:parametric t:[0, 2*pi]'));

    await runTest('Plot command handle implicit polar lemniscate', () =>
        handlePlotCommand('r^2 = 9 * cos(2*theta) kind:polar theta:[0, 2*pi] x:[-4, 4] y:[-4, 4]'));

    await runTest('Plot command rejects ambiguous tuple without kind', async () => {
        const res = await handlePlotCommand('(-y, x) x:[-5, 5] y:[-5, 5]');
        if (!res.success) return { ...res, expectFail: true };
        return { success: false, error: 'Expected ambiguity failure but got success' };
    });

    await runTest('Plot command handle scalar with custom horizontal variable', () =>
        handlePlotCommand('cos(t) vars:{t} t:[0, 2*pi] y:[-2, 2]'));

    await runTest('Plot command handle 3D scalar surface with custom vars', () =>
        handlePlotCommand('cos(t)*sin(s) view:3d kind:surface vars:{t, s} t:[-3, 3] s:[-3, 3]'));

    await runTest('Plot command handle 3D embedded explicit 2D curve', () =>
        handlePlotCommand('y = sin(x) view:3d x:[-10, 10] y:[-2, 2]'));

    await runTest('Plot command handle 3D embedded implicit 2D curve', () =>
        handlePlotCommand('x^2 + y^2 = 1 view:3d x:[-2, 2] y:[-2, 2]'));

    await runTest('Plot3d laplacian surface', () =>
        renderer.renderPlot3d('z = lap("x^2 + y^2")', { xDomain: [-3, 3], yDomain: [-3, 3], zDomain: [0, 8] }));

    await runTest('Plot command handle 3D parametric torus surface', () =>
        handlePlotCommand('(cos(u)*(2 + cos(v)), sin(u)*(2 + cos(v)), sin(v)) view:3d kind:surface vars:{u, v} u:[0, 2*pi] v:[0, 2*pi]'));

    await runTest('Plot command handle 3D explicit cylindrical surface (cylinder)', () =>
        handlePlotCommand('r = 3 view:3d kind:surface z:[-5, 5]'));

    await runTest('Plot command handle 3D explicit spherical surface (bumpy sphere)', () =>
        handlePlotCommand('r = 2 + 0.5 * sin(6*theta) * sin(6*phi) view:3d kind:surface'));

    await runTest('Plot command handle 3D implicit sphere', () =>
        handlePlotCommand('x^2 + y^2 + z^2 = 1 view:3d x:[-2, 2] y:[-2, 2] z:[-2, 2]'));

    await runTest('Plot command handle 3D cylindrical vector field', () =>
        handlePlotCommand('F(r, theta, z) = (0, r, 0.2) view:3d kind:vector vars:{r, theta, z} r:[1, 5] theta:[0, 2*pi] z:[-2, 2]'));

    await runTest('Plot command handle 3D spherical vector field', () =>
        handlePlotCommand('F(r, theta, phi) = (1/r^2, 0, 0) view:3d kind:vector vars:{r, theta, phi} r:[1, 4] theta:[0, pi] phi:[0, 2*pi]'));

    await runTest('Plot command handle 2D explicit with separate display limits (xlim/ylim)', () =>
        handlePlotCommand('y = x^2 x:[2, 5] xlim:[-10, 10] ylim:[-5, 30]'));

    await runTest('Plot command handle 3D explicit with separate display limit (zlim)', () =>
        handlePlotCommand('z = x^2 + y^2 view:3d z:[2, 5] zlim:[-10, 10]'));

    await runTest('Plot factorial y = x!', () =>
        renderer.renderPlot('y = x!', { xDomain: [-5, 5], yDomain: [-10, 10] }));

    await runTest('Plot polygamma y = polygamma(0, x)', () =>
        renderer.renderPlot('y = polygamma(0, x)', { xDomain: [-5, 5], yDomain: [-10, 10] }));

    const solver = require('../src/solver');
    await runTest('Solve quadratic', async () => {
        const res = await solver.solveEquation('x^2 - 5x + 6 = 0');
        if (res.success) return await renderer.render(res.latex, true);
        return res;
    });

    await runTest('Solve system', async () => {
        const res = await solver.solveEquation('x + y = 5; x - y = 1');
        if (res.success) return await renderer.render(res.latex, true);
        return res;
    });

    await runTest('Solve transcendental cos(x) - x', async () => {
        const res = await solver.solveEquation('cos(x) - x = 0');
        if (res.success) return await renderer.render(res.latex, true);
        return res;
    });

    console.log('\nShutting down...');
    await renderer.close();
    console.log('--- DONE ---');
}

runTests().catch(err => {
    console.error('Fatal error:', err);
});
