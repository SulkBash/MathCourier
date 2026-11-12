const handlePdeCommand = require('../src/commands/pde');
const renderer = require('../src/renderer');
const katex = require('../src/renderer/katex');
const assert = require('assert');
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

        await harness.runTest('PDE surface uses the actual variable names as axis titles', async () => {
            const originalCreatePage = katex.createRenderPage;
            let titles = null;
            katex.createRenderPage = async () => {
                const page = await originalCreatePage();
                const evaluate = page.evaluate.bind(page);
                page.evaluate = async (...args) => {
                    const result = await evaluate(...args);
                    const renderedTitles = await evaluate(() => {
                        const plot = document.getElementById('plotly-graph');
                        const scene = plot && plot.layout && plot.layout.scene;
                        return scene ? [scene.xaxis.title.text, scene.yaxis.title.text, scene.zaxis.title.text] : null;
                    });
                    if (renderedTitles) titles = renderedTitles;
                    return result;
                };
                return page;
            };
            try {
                const result = await renderer.renderPde({
                    success: true,
                    x: [0, 1], t: [0, 1], u: [[0, 1], [1, 0]],
                    xDomain: [0, 1], tDomain: [0, 1], pde_latex: '',
                    spatial_variable: 'X', temporal_variable: 'T', dependent_variable: 'v'
                });
                harness.expectMediaSuccess(result);
                assert.deepStrictEqual(titles, ['X', 'T', 'v']);
                console.log('  ok: X, T, and v are displayed on the correct axes');
            } finally {
                katex.createRenderPage = originalCreatePage;
            }
        });

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
