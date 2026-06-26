const renderer = require('../src/renderer');
const { createHarness } = require('./test-harness');

const harness = createHarness('RENDER TESTS');

async function runTests() {
    console.log('--- STARTING RENDER TESTS ---');
    
    await renderer.initialize();
    console.log(`Renderer: ${renderer.isLocalReady() ? 'local' : 'fallback only'}`);
    
    harness.ensureOutputDir();

    await harness.runTest('Gaussian integral', async () => {
        const result = await renderer.render('\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}', true);
        harness.writeResult('Gaussian integral', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Mixed text + equation', async () => {
        const result = await renderer.render(
            'Solving the quadratic equation:\nFor a quadratic of the form ax^2 + bx + c = 0, the roots are given by:\n$$\\displaystyle x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$',
            false
        );
        harness.writeResult('Mixed text + equation', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Invalid LaTeX (expect error)', async () => {
        const res = await renderer.render('\\frac{a}{b', true);
        harness.expectFailure(res);
    });

    await harness.runTest('Chemfig benzene', async () => {
        const result = await renderer.renderChem('\\chemfig{A-B*6(=-=-=-)}');
        harness.writeResult('Chemfig benzene', harness.expectMediaSuccess(result));
    });

    await harness.runTest('TikZ circle', async () => {
        const result = await renderer.renderTikz(`
\\draw[thick, fill=blue!10] (0,0) circle (1.5);
\\node[align=center] at (0,0) {TikZ\\\\Works!};
\\draw[->, red, very thick] (-2,2) -- (-0.2,0.2);
`);
        harness.writeResult('TikZ circle', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Circuitikz diagram', async () => {
        const result = await renderer.renderTikz(`
\\draw (0,0) to[R, l=$R$] (2,0)
      to[C, l=$C$] (2,2)
      to[L, l=$L$] (0,2)
      to[V, l=$V$] (0,0);
`);
        harness.writeResult('Circuitikz diagram', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot explicit sin*cos', async () => {
        const result = await renderer.renderPlot('sin(x) * cos(x/2)', { xDomain: [-10, 10], yDomain: [-2, 2] });
        harness.writeResult('Plot explicit sin*cos', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot multi explicit curves', async () => {
        const result = await renderer.renderPlot('y = sin(x), y = cos(x), y = x/5', { xDomain: [-10, 10], yDomain: [-2, 2] });
        harness.writeResult('Plot multi explicit curves', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot multi mixed explicit and implicit curves', async () => {
        const result = await renderer.renderPlot('y = x^2, x^2 + y^2 = 9', { xDomain: [-4, 4], yDomain: [-4, 4] });
        harness.writeResult('Plot multi mixed explicit and implicit curves', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot implicit circle', async () => {
        const result = await renderer.renderPlot('x^2 + y^2 = 1', { xDomain: [-1.5, 1.5], yDomain: [-1.5, 1.5] });
        harness.writeResult('Plot implicit circle', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot implicit elliptic curve', async () => {
        const result = await renderer.renderPlot('y^2 = x^3 - x', { xDomain: [-2, 2], yDomain: [-2, 2] });
        harness.writeResult('Plot implicit elliptic curve', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot arctan equation', async () => {
        const result = await renderer.renderPlot('arctan(x^3-x+y)=y^2', { xDomain: [-10, 10], yDomain: [-10, 10] });
        harness.writeResult('Plot arctan equation', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot invalid (expect error)', async () => {
        const res = await renderer.renderPlot('y = sin(x /');
        harness.expectFailure(res);
    });

    await harness.runTest('Plot vector field', async () => {
        const result = await renderer.renderPlot('v(x,y)=(sin(x)/xy,cos(y)/xy)', { xDomain: [-2, 2], yDomain: [-2, 2] });
        harness.writeResult('Plot vector field', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot explicit vector field kind override', async () => {
        const result = await renderer.renderPlot('(-y, x)', { xDomain: [-5, 5], yDomain: [-5, 5], kind: 'vector' });
        harness.writeResult('Plot explicit vector field kind override', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot ln(x)', async () => {
        const result = await renderer.renderPlot('y = ln(x)', { xDomain: [-10, 10], yDomain: [-10, 10] });
        harness.writeResult('Plot ln(x)', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot derivative of x^3', async () => {
        const result = await renderer.renderPlot('y = deriv("x^3", "x", x)', { xDomain: [-3, 3], yDomain: [-10, 10] });
        harness.writeResult('Plot derivative of x^3', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot integral of sin(t)', async () => {
        const result = await renderer.renderPlot('y = integ("sin(t)", "t:[0, x]")', { xDomain: [-10, 10], yDomain: [-3, 3] });
        harness.writeResult('Plot integral of sin(t)', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot laplacian of x^3', async () => {
        const result = await renderer.renderPlot('y = lap("x^3")', { xDomain: [-3, 3], yDomain: [-20, 20] });
        harness.writeResult('Plot laplacian of x^3', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot gradient field of x^2 + y^2', async () => {
        const result = await renderer.renderPlot(
            'v(x,y) = (gradx("x^2 + y^2"), grady("x^2 + y^2"))',
            { xDomain: [-3, 3], yDomain: [-3, 3] }
        );
        harness.writeResult('Plot gradient field of x^2 + y^2', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot implicit gradient field of x^2 + y^2 (expect ambiguity error)', async () => {
        const res = await renderer.renderPlot(
            '(gradx("x^2 + y^2"), grady("x^2 + y^2"))',
            { xDomain: [-3, 3], yDomain: [-3, 3] }
        );
        harness.expectFailure(res);
    });

    await harness.runTest('Plot parametric Lissajous curve', async () => {
        const result = await renderer.renderPlot('(cos(3*t), sin(2*t))', { domains: [[0, 2*Math.PI]] });
        harness.writeResult('Plot parametric Lissajous curve', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot polar cardioid', async () => {
        const result = await renderer.renderPlot('r = 2 * (1 - cos(theta))', { domains: [[0, 2*Math.PI]] });
        harness.writeResult('Plot polar cardioid', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot polar rose', async () => {
        const result = await renderer.renderPlot('r = sin(4*theta)', { domains: [[0, 2*Math.PI]] });
        harness.writeResult('Plot polar rose', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot implicit polar lemniscate', async () => {
        const result = await renderer.renderPlot('r^2 = 9 * cos(2*theta)', { domains: [[-4, 4], [-4, 4]] });
        harness.writeResult('Plot implicit polar lemniscate', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot multi-plot overlay parametric and polar', async () => {
        const result = await renderer.renderPlot('(cos(t), sin(t)), r = 1.5', { domains: [[0, 2*Math.PI]] });
        harness.writeResult('Plot multi-plot overlay parametric and polar', harness.expectMediaSuccess(result));
    });

    const handlePlotCommand = require('../src/commands/plot');
    await harness.runTest('Plot command handle parametric Lissajous', async () => {
        const result = await handlePlotCommand('(cos(3*t), sin(2*t)) kind:parametric t:[0, 2*pi]');
        harness.writeResult('Plot command handle parametric Lissajous', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot command handle implicit polar lemniscate', async () => {
        const result = await handlePlotCommand('r^2 = 9 * cos(2*theta) kind:polar theta:[0, 2*pi] x:[-4, 4] y:[-4, 4]');
        harness.writeResult('Plot command handle implicit polar lemniscate', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot command rejects ambiguous tuple without kind', async () => {
        const res = await handlePlotCommand('(-y, x) x:[-5, 5] y:[-5, 5]');
        harness.expectFailure(res);
    });

    await harness.runTest('Plot command handle scalar with custom horizontal variable', async () => {
        const result = await handlePlotCommand('cos(t) vars:{t} t:[0, 2*pi] y:[-2, 2]');
        harness.writeResult('Plot command handle scalar with custom horizontal variable', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot command handle 3D scalar surface with custom vars', async () => {
        const result = await handlePlotCommand('cos(t)*sin(s) view:3d kind:surface vars:{t, s} t:[-3, 3] s:[-3, 3]');
        harness.writeResult('Plot command handle 3D scalar surface with custom vars', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot command handle 3D embedded explicit 2D curve', async () => {
        const result = await handlePlotCommand('y = sin(x) view:3d x:[-10, 10] y:[-2, 2]');
        harness.writeResult('Plot command handle 3D embedded explicit 2D curve', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot command handle 3D embedded implicit 2D curve', async () => {
        const result = await handlePlotCommand('x^2 + y^2 = 1 view:3d x:[-2, 2] y:[-2, 2]');
        harness.writeResult('Plot command handle 3D embedded implicit 2D curve', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot3d laplacian surface', async () => {
        const result = await renderer.renderPlot3d('z = lap("x^2 + y^2")', { xDomain: [-3, 3], yDomain: [-3, 3], zDomain: [0, 8] });
        harness.writeResult('Plot3d laplacian surface', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot command handle 3D parametric torus surface', async () => {
        const result = await handlePlotCommand('(cos(u)*(2 + cos(v)), sin(u)*(2 + cos(v)), sin(v)) view:3d kind:surface vars:{u, v} u:[0, 2*pi] v:[0, 2*pi]');
        harness.writeResult('Plot command handle 3D parametric torus surface', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot command handle 3D explicit cylindrical surface (cylinder)', async () => {
        const result = await handlePlotCommand('r = 3 view:3d kind:surface z:[-5, 5]');
        harness.writeResult('Plot command handle 3D explicit cylindrical surface (cylinder)', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot command handle 3D explicit spherical surface (bumpy sphere)', async () => {
        const result = await handlePlotCommand('r = 2 + 0.5 * sin(6*theta) * sin(6*phi) view:3d kind:surface');
        harness.writeResult('Plot command handle 3D explicit spherical surface (bumpy sphere)', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot command handle 3D implicit sphere', async () => {
        const result = await handlePlotCommand('x^2 + y^2 + z^2 = 1 view:3d x:[-2, 2] y:[-2, 2] z:[-2, 2]');
        harness.writeResult('Plot command handle 3D implicit sphere', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot command handle 3D cylindrical vector field', async () => {
        const result = await handlePlotCommand('F(r, theta, z) = (0, r, 0.2) view:3d kind:vector vars:{r, theta, z} r:[1, 5] theta:[0, 2*pi] z:[-2, 2]');
        harness.writeResult('Plot command handle 3D cylindrical vector field', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot command handle 3D spherical vector field', async () => {
        const result = await handlePlotCommand('F(r, theta, phi) = (1/r^2, 0, 0) view:3d kind:vector vars:{r, theta, phi} r:[1, 4] theta:[0, pi] phi:[0, 2*pi]');
        harness.writeResult('Plot command handle 3D spherical vector field', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot command handle 2D explicit with separate display limits (xlim/ylim)', async () => {
        const result = await handlePlotCommand('y = x^2 x:[2, 5] xlim:[-10, 10] ylim:[-5, 30]');
        harness.writeResult('Plot command handle 2D explicit with separate display limits (xlim/ylim)', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot command handle 3D explicit with separate display limit (zlim)', async () => {
        const result = await handlePlotCommand('z = x^2 + y^2 view:3d z:[2, 5] zlim:[-10, 10]');
        harness.writeResult('Plot command handle 3D explicit with separate display limit (zlim)', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot factorial y = x!', async () => {
        const result = await renderer.renderPlot('y = x!', { xDomain: [-5, 5], yDomain: [-10, 10] });
        harness.writeResult('Plot factorial y = x!', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Plot polygamma y = polygamma(0, x)', async () => {
        const result = await renderer.renderPlot('y = polygamma(0, x)', { xDomain: [-5, 5], yDomain: [-10, 10] });
        harness.writeResult('Plot polygamma y = polygamma(0, x)', harness.expectMediaSuccess(result));
    });

    const solver = require('../src/solver');
    await harness.runTest('Solve quadratic', async () => {
        const res = await solver.solveEquation('x^2 - 5x + 6 = 0');
        harness.expectSuccess(res, 'Quadratic solve failed.');
        const result = await renderer.render(res.latex, true);
        harness.writeResult('Solve quadratic', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Solve system', async () => {
        const res = await solver.solveEquation('x + y = 5; x - y = 1');
        harness.expectSuccess(res, 'System solve failed.');
        const result = await renderer.render(res.latex, true);
        harness.writeResult('Solve system', harness.expectMediaSuccess(result));
    });

    await harness.runTest('Solve transcendental cos(x) - x', async () => {
        const res = await solver.solveEquation('cos(x) - x = 0');
        harness.expectSuccess(res, 'Transcendental solve failed.');
        const result = await renderer.render(res.latex, true);
        harness.writeResult('Solve transcendental cos(x) - x', harness.expectMediaSuccess(result));
    });

    console.log('\nShutting down...');
    await renderer.close();
    harness.finish();
}

runTests().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
