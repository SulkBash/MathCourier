const fs = require('fs');
const path = require('path');
const renderer = require('../src/renderer');
const handlePlotCommand = require('../src/commands/plot');
const handleOdeCommand = require('../src/commands/ode');
const handlePdeCommand = require('../src/commands/pde');

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
        } else {
            console.error(`  FAIL: ${result.error}`);
            process.exitCode = 1;
        }
    } catch (err) {
        console.error(`  FAIL (exception): ${err.message}`);
        process.exitCode = 1;
    }
}

async function runTests() {
    console.log('--- STARTING LABELED DOMAINS TESTS ---');

    await renderer.initialize();
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

    // Test 1: Labeled X domain in 2D plot
    await runTest('Plot 2D with labeled X domain', () =>
        handlePlotCommand('y = sin(x) x:[-2, 2]')
    );

    // Test 2: Labeled Y domain in 2D plot
    await runTest('Plot 2D with labeled Y domain', () =>
        handlePlotCommand('y = sin(x) y:[-0.5, 0.5]')
    );

    // Test 3: Labeled Z domain in 3D plot
    await runTest('Plot 3D with labeled Z domain only', () =>
        handlePlotCommand('z = x^2 + y^2 view:3d z:[0, 4]')
    );

    // Test 4: Labeled evolution variable sweep range in 3D animated plot
    await runTest('Plot 3D animated with labeled sweep range', () =>
        handlePlotCommand('z = sin(x - t) * cos(y) view:3d animate:t t:[0, pi]')
    );

    // Test 5: Labeled domain in ODE solver
    await runTest('ODE with labeled t and x domains', () =>
        handleOdeCommand('dx/dt = -y; dy/dt = x mode:num ic:{x(0)=1; y(0)=0} phase:{x, y} t:[0, 2*pi] x:[-2, 2]')
    );

    // Test 6: Labeled space domain in PDE solver
    await runTest('PDE with labeled x space domain', () =>
        handlePdeCommand('du/dt = d2u/dx2 ic:{u(x,0) = sin(x)} bc:{u(0,t)=0; u(pi,t)=0} x:[0, pi] t:[0, 2]')
    );

    // Test 7: Labeled domains in multivariable integration
    const solver = require('../src/solver');
    await runTest('Integration with labeled domains', async () => {
        const res = await solver.solveIntegral('x * y * z kind:volume x:[0, 1] y:[0, 2] z:[0, 3]');
        if (!res.success) return res;
        return await renderer.render(res.latex, true);
    });

    console.log('\nShutting down...');
    await renderer.close();
    console.log('--- LABELED DOMAINS TESTS DONE ---');
}

runTests().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
