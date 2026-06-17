const fs = require('fs');
const path = require('path');
const renderer = require('./renderer');

const OUTPUT_DIR = path.join(__dirname, 'test_output');

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
            'Solving the quadratic equation:\nFor $a x^2 + b x + c = 0$, the roots are given by:\n$$\\displaystyle x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$',
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

    await runTest('Plot explicit sin*cos', () =>
        renderer.renderPlot('sin(x) * cos(x/2)', { xDomain: [-10, 10], yDomain: [-2, 2] }));

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

    await runTest('Plot ln(x)', () =>
        renderer.renderPlot('y = ln(x)', { xDomain: [-10, 10], yDomain: [-10, 10] }));

    await runTest('Plot derivative of x^3', () =>
        renderer.renderPlot('y = deriv("x^3", "x", x)', { xDomain: [-3, 3], yDomain: [-10, 10] }));

    await runTest('Plot integral of sin(t)', () =>
        renderer.renderPlot('y = integ("sin(t)", "t", 0, x)', { xDomain: [-10, 10], yDomain: [-3, 3] }));

    await runTest('Plot factorial y = x!', () =>
        renderer.renderPlot('y = x!', { xDomain: [-5, 5], yDomain: [-10, 10] }));

    await runTest('Plot polygamma y = polygamma(0, x)', () =>
        renderer.renderPlot('y = polygamma(0, x)', { xDomain: [-5, 5], yDomain: [-10, 10] }));

    const solver = require('./solver');
    await runTest('Solve quadratic', async () => {
        const res = solver.solveEquation('x^2 - 5x + 6 = 0');
        if (res.success) return await renderer.render(res.latex, true);
        return res;
    });

    await runTest('Solve system', async () => {
        const res = solver.solveEquation('x + y = 5; x - y = 1');
        if (res.success) return await renderer.render(res.latex, true);
        return res;
    });

    await runTest('Solve transcendental cos(x) - x', async () => {
        const res = solver.solveEquation('cos(x) - x = 0');
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
