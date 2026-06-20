const handlePlotCommand = require('../src/commands/plot');
const renderer = require('../src/renderer');
const fs = require('fs');
const path = require('path');

const testCases = [
    {
        name: '1. Explicit Curve Tracing (-e[x])',
        input: '-e[x] y = sin(x) [-10, 10]'
    },
    {
        name: '2. Explicit Curve Tracing along Y (-e[y])',
        input: '-e[y] y = 2*x [-5, 5]'
    },
    {
        name: '3. Explicit Curve Parameter Sweep (traveling wave -e[t])',
        input: '-e[t] y = sin(x - t) [-10, 10] [0, 2*pi]'
    },
    {
        name: '4. Parametric Curve Tracing (-et)',
        input: '-et (cos(t), sin(t)) [0, 2*pi]'
    },
    {
        name: '5. Parametric Curve Parameter Sweep (-e[a])',
        input: '-e[a] (2*cos(t - a), sin(t - a)) [0, 2*pi] [0, 2*pi]'
    },
    {
        name: '6. Polar Curve Tracing (-e[theta])',
        input: '-e[theta] r = 2 * (1 - cos(theta)) [0, 2*pi]'
    },
    {
        name: '7. Vector Field Tracing (-ex)',
        input: '-ex v(x,y) = (-y, x) [-5, 5] [-5, 5]'
    }
];

async function runTests() {
    console.log('=== STARTING 2D PLOT ANIMATION INTEGRATION TESTS ===\n');

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
                const renderRes = await handlePlotCommand(tc.input);
                if (!renderRes.success) {
                    console.log(`Execution Failed: ${renderRes.error}`);
                    console.log('--------------------------------------------\n');
                    continue;
                }

                console.log(`Execution Success!`);
                const isAnim = renderRes.isAnimation;
                const ext = isAnim ? 'mp4' : 'png';
                const imgBuf = Buffer.from(renderRes.data, 'base64');
                const outPath = path.join(outputDir, `plot_anim_test_${i + 1}.${ext}`);
                
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
