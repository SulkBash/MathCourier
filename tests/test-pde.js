const handlePdeCommand = require('../src/commands/pde');
const renderer = require('../src/renderer');
const { createHarness } = require('./test-harness');

const harness = createHarness('PDE SOLVER & VISUALIZER INTEGRATION TESTS');

const testCases = [
    {
        name: '1. Heat Equation (3D Static)',
        input: 'du/dt = 0.5 * d2u/dx2 ic:{u(x,0) = sin(x)} bc:{u(0,t)=0; u(pi,t)=0} x:[0, pi] t:[0, 2]'
    },
    {
        name: '2. Heat Equation (3D rotating anim -ay)',
        input: 'du/dt = 0.5 * d2u/dx2 ic:{u(x,0) = sin(x)} bc:{u(0,t)=0; u(pi,t)=0} camera:y x:[0, pi] t:[0, 2]'
    },
    {
        name: '3. Heat Equation (2D Static Slices)',
        input: 'du/dt = 0.5 * d2u/dx2 ic:{u(x,0) = sin(x)} bc:{u(0,t)=0; u(pi,t)=0} view:2d x:[0, pi] t:[0, 2]'
    },
    {
        name: '4. Heat Equation (2D Time Evolution Anim)',
        input: 'du/dt = 0.5 * d2u/dx2 ic:{u(x,0) = sin(x)} bc:{u(0,t)=0; u(pi,t)=0} view:2d camera:z x:[0, pi] t:[0, 2]'
    },
    {
        name: '5. Wave Equation (3D Static)',
        input: 'd2u/dt2 = 4 * d2u/dx2 ic:{u(x,0) = sin(x); du/dt(x,0)=0} bc:{u(0,t)=0; u(pi,t)=0} x:[0, pi] t:[0, 3]'
    },
    {
        name: '6. Wave Equation (2D Time Evolution Anim)',
        input: 'd2u/dt2 = 4 * d2u/dx2 ic:{u(x,0) = sin(x); du/dt(x,0)=0} bc:{u(0,t)=0; u(pi,t)=0} view:2d camera:z x:[0, pi] t:[0, 3]'
    },
    {
        name: '7. Damped Wave Equation (3D Static)',
        input: 'd2u/dt2 = 4 * d2u/dx2 - 0.5 * du/dt ic:{u(x,0) = sin(x); du/dt(x,0)=0} bc:{u(0,t)=0; u(pi,t)=0} x:[0, pi] t:[0, 4]'
    }
];

async function runTests() {
    console.log('=== STARTING PDE SOLVER & VISUALIZER INTEGRATION TESTS ===\n');
    harness.ensureOutputDir();

    try {
        console.log('Bootstrapping LaTeX Renderer (Puppeteer)...');
        await renderer.initialize();
        console.log('Renderer ready.\n');

        for (const tc of testCases) {
            await harness.runTest(tc.name, async () => {
                console.log(`Command input: "${tc.input}"`);
                const renderRes = await handlePdeCommand(tc.input);
                harness.writeResult(tc.name, harness.expectMediaSuccess(renderRes));
                console.log('--------------------------------------------');
            });
        }
    } catch (err) {
        console.error('Failure in test runner setup:', err);
        process.exitCode = 1;
    } finally {
        console.log('Shutting down Renderer...');
        await renderer.close();
        harness.finish();
    }
}

runTests().catch((err) => {
    console.error('Fatal PDE integration test error:', err);
    process.exit(1);
});
