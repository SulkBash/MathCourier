const fs = require('fs');
const path = require('path');
const renderer = require('../src/renderer');
const handlePlot3dCommand = require('../src/commands/plot3d');

const OUTPUT_DIR = path.join(__dirname, '../test_output');

function getExtension(result) {
    if (result.mimeType === 'video/mp4') return '.mp4';
    if (result.mimeType === 'image/jpeg') return '.jpg';
    return '.png';
}

function writeResult(name, result) {
    const extension = getExtension(result);
    const filename = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '') + extension;
    const out = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(out, Buffer.from(result.data, 'base64'));
    console.log(`  ok (${result.source}) -> ${out}`);
}

async function runTest(name, fn) {
    console.log(`\n${name}`);
    try {
        const result = await fn();
        if (result.success && result.data) {
            writeResult(name, result);
        } else {
            console.error(`  FAIL: ${result.error}`);
        }
    } catch (err) {
        console.error(`  FAIL (exception): ${err.message}`);
    }
}

async function runParallelTests(name, cases) {
    console.log(`\n${name}`);

    try {
        const results = await Promise.all(cases.map(testCase => testCase.fn()));
        results.forEach((result, index) => {
            const label = `${name} ${cases[index].name}`;
            if (result.success && result.data) {
                writeResult(label, result);
            } else {
                console.error(`  FAIL (${cases[index].name}): ${result.error}`);
            }
        });
    } catch (err) {
        console.error(`  FAIL (parallel exception): ${err.message}`);
    }
}

async function runTests() {
    console.log('--- STARTING 3D PLOTTING TESTS ---');
    
    await renderer.initialize();
    console.log(`Renderer status: ${renderer.isLocalReady() ? 'local ready' : 'local not ready'}`);
    
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    await runTest('3D Static Surface Explicit', () =>
        handlePlot3dCommand('z = sin(x) * cos(y) [-3, 3] [-3, 3]')
    );

    await runTest('3D Static Surface Integral', () =>
        handlePlot3dCommand('z = integ("cos(t)*y", "t", 0, x) [-5, 5] [-5, 5]')
    );

    await runTest('3D Static Parametric Curve', () =>
        handlePlot3dCommand('(sin(t), cos(t), t) [0, 6*pi]')
    );

    await runTest('3D Static Implicit Sphere', () =>
        handlePlot3dCommand('x^2 + y^2 + z^2 = 1 [-6, 6] [-6, 6]')
    );

    await runTest('3D Static Surface From Linear Z Equation', () =>
        handlePlot3dCommand('4x^3 + 2yx + z = 0 [-10, 10] [-10, 10]')
    );

    await runTest('3D Animated Implicit Sphere', () =>
        handlePlot3dCommand('-a x^2 + y^2 + z^2 = 1 [-6, 6] [-6, 6]')
    );

    await runTest('3D Animated Surface Explicit', () =>
        handlePlot3dCommand('-a z = sin(x) * cos(y) [-3, 3] [-3, 3]')
    );

    await runTest('3D Animated Full Orbit Sphere', () =>
        handlePlot3dCommand('-a360 x^2 + y^2 + z^2 = 1 [-6, 6] [-6, 6]')
    );

    await runParallelTests('3D Parallel Animated Requests', [
        {
            name: 'surface',
            fn: () => handlePlot3dCommand('-a z = sin(x) * cos(y) [-3, 3] [-3, 3]')
        },
        {
            name: 'curve',
            fn: () => handlePlot3dCommand('-a (sin(t), cos(t), t) [0, 6*pi]')
        }
    ]);

    await runTest('3D Static Vector Field Explicit', () =>
        handlePlot3dCommand('F(x,y,z) = (-y, x, z/2) [-4, 4] [-4, 4] [-4, 4]')
    );

    await runTest('3D Static Vector Field Implicit', () =>
        handlePlot3dCommand('(-y, x, z/2) [-4, 4] [-4, 4] [-4, 4]')
    );

    console.log('\nShutting down renderer...');
    await renderer.close();
    console.log('--- DONE ---');
}

runTests().catch(err => {
    console.error('Fatal error during test run:', err);
});
