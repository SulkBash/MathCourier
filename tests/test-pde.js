const handlePdeCommand = require('../src/commands/pde');
const renderer = require('../src/renderer');
const fs = require('fs');
const path = require('path');

const testCases = [
    {
        name: '1. Heat Equation (3D Static)',
        input: 'du/dt = 0.5 * d2u/dx2, u(x,0) = sin(x), u(0,t)=0, u(pi,t)=0 [0, pi] [0, 2]'
    },
    {
        name: '2. Heat Equation (3D rotating anim -ay)',
        input: '-ay du/dt = 0.5 * d2u/dx2, u(x,0) = sin(x), u(0,t)=0, u(pi,t)=0 [0, pi] [0, 2]'
    },
    {
        name: '3. Heat Equation (2D Static Slices)',
        input: '-2d du/dt = 0.5 * d2u/dx2, u(x,0) = sin(x), u(0,t)=0, u(pi,t)=0 [0, pi] [0, 2]'
    },
    {
        name: '4. Heat Equation (2D Time Evolution Anim)',
        input: '-2d -a du/dt = 0.5 * d2u/dx2, u(x,0) = sin(x), u(0,t)=0, u(pi,t)=0 [0, pi] [0, 2]'
    },
    {
        name: '5. Wave Equation (3D Static)',
        input: 'd2u/dt2 = 4 * d2u/dx2, u(x,0) = sin(x), du/dt(x,0)=0, u(0,t)=0, u(pi,t)=0 [0, pi] [0, 3]'
    },
    {
        name: '6. Wave Equation (2D Time Evolution Anim)',
        input: '-2d -a d2u/dt2 = 4 * d2u/dx2, u(x,0) = sin(x), du/dt(x,0)=0, u(0,t)=0, u(pi,t)=0 [0, pi] [0, 3]'
    },
    {
        name: '7. Damped Wave Equation (3D Static)',
        input: 'd2u/dt2 = 4 * d2u/dx2 - 0.5 * du/dt, u(x,0) = sin(x), du/dt(x,0)=0, u(0,t)=0, u(pi,t)=0 [0, pi] [0, 4]'
    }
];

async function runTests() {
    console.log('=== STARTING PDE SOLVER & VISUALIZER INTEGRATION TESTS ===\n');

    const outputDir = path.join(__dirname, '../test_output');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    try {
        console.log('Bootstrapping LaTeX Renderer (Puppeteer)...');
        await renderer.initialize();
        console.log('Renderer ready.\n');

        for (let i = 0; i < testCases.length; i++) {
            const tc = testCases[i];
            console.log(`--- Test ${i + 1}: ${tc.name} ---`);
            console.log(`Command input: "${tc.input}"`);

            try {
                const renderRes = await handlePdeCommand(tc.input);
                if (!renderRes.success) {
                    console.log(`Execution Failed: ${renderRes.error}`);
                    console.log('--------------------------------------------\n');
                    continue;
                }

                console.log(`Execution Success!`);
                const isAnim = renderRes.isAnimation;
                const ext = isAnim ? 'mp4' : 'png';
                const imgBuf = Buffer.from(renderRes.data, 'base64');
                const outPath = path.join(outputDir, `pde_test_${i + 1}.${ext}`);
                
                fs.writeFileSync(outPath, imgBuf);
                console.log(`Saved output to: ${outPath}`);

            } catch (err) {
                console.error(`Unexpected Error during test:`, err);
            }
            console.log('--------------------------------------------\n');
        }
    } catch (err) {
        console.error('Failure in test runner setup:', err);
    } finally {
        console.log('Shutting down Renderer...');
        await renderer.close();
        console.log('Integration tests complete.');
    }
}

runTests();
