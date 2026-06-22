const fs = require('fs');
const path = require('path');
const renderer = require('../src/renderer');
const handlePlotCommand = require('../src/commands/plot');

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
        handlePlotCommand('z = sin(x) * cos(y) view:3d x:[-3, 3] y:[-3, 3]')
    );

    await runTest('3D Static Surface Integral', () =>
        handlePlotCommand('z = integ("cos(t)*y", "t", 0, x) view:3d x:[-5, 5] y:[-5, 5]')
    );

    await runTest('3D Static Parametric Curve', () =>
        handlePlotCommand('(sin(t), cos(t), t) view:3d kind:curve vars:{t} t:[0, 6*pi]')
    );

    await runTest('3D Delimited Parametric Curve', () =>
        handlePlotCommand('(sin(t), cos(t), t/3) view:3d kind:curve vars:{t} camera:z animate:t t:[0, 6*pi] z:[-4, 4]')
    );

    await runTest('3D Static Implicit Sphere', () =>
        handlePlotCommand('x^2 + y^2 + z^2 = 1 view:3d x:[-6, 6] y:[-6, 6] z:[-6, 6]')
    );

    await runTest('3D Static Surface From Linear Z Equation', () =>
        handlePlotCommand('4x^3 + 2yx + z = 0 view:3d x:[-10, 10] y:[-10, 10]')
    );

    await runTest('3D Animated Implicit Sphere', () =>
        handlePlotCommand('x^2 + y^2 + z^2 = 1 view:3d camera:z x:[-6, 6] y:[-6, 6] z:[-6, 6]')
    );

    await runTest('3D Animated Surface Explicit', () =>
        handlePlotCommand('z = sin(x) * cos(y) view:3d camera:z x:[-3, 3] y:[-3, 3]')
    );

    await runTest('3D Animated Full Orbit Sphere', () =>
        handlePlotCommand('x^2 + y^2 + z^2 = 1 view:3d camera:z360 x:[-6, 6] y:[-6, 6] z:[-6, 6]')
    );

    await runTest('3D Animated Swing X Axis Sphere', () =>
        handlePlotCommand('x^2 + y^2 + z^2 = 1 view:3d camera:x x:[-6, 6] y:[-6, 6] z:[-6, 6]')
    );

    await runTest('3D Animated Orbit Y Axis 180 Degrees Sphere', () =>
        handlePlotCommand('x^2 + y^2 + z^2 = 1 view:3d camera:y180 x:[-6, 6] y:[-6, 6] z:[-6, 6]')
    );

    await runTest('3D Animated Orbit Z Axis 360 Degrees Sphere', () =>
        handlePlotCommand('x^2 + y^2 + z^2 = 1 view:3d camera:z360 x:[-6, 6] y:[-6, 6] z:[-6, 6]')
    );

    await runTest('3D Evolution Surface Sweep', () =>
        handlePlotCommand('z = sin(x - t) * cos(y) view:3d animate:t x:[-3, 3] y:[-3, 3] t:[0, 2*pi] z:[-1.2, 1.2]')
    );

    await runTest('3D Evolution Parametric Curve Trace', () =>
        handlePlotCommand('(sin(t), cos(t), t/3) view:3d kind:curve vars:{t} animate:t t:[0, 6*pi]')
    );

    await runTest('3D Combined Camera And Evolution Surface', () =>
        handlePlotCommand('z = sin(x - t) * cos(y) view:3d camera:z animate:t x:[-3, 3] y:[-3, 3] t:[0, 2*pi] z:[-1.2, 1.2]')
    );

    await runParallelTests('3D Parallel Animated Requests', [
        {
            name: 'surface',
            fn: () => handlePlotCommand('z = sin(x) * cos(y) view:3d camera:z x:[-3, 3] y:[-3, 3]')
        },
        {
            name: 'curve',
            fn: () => handlePlotCommand('(sin(t), cos(t), t) view:3d kind:curve vars:{t} camera:z t:[0, 6*pi]')
        }
    ]);

    await runTest('3D Static Vector Field Streamlines Default', () =>
        handlePlotCommand('F(x,y,z) = (-y, x, z/2) view:3d kind:vector vars:{x, y, z} x:[-4, 4] y:[-4, 4] z:[-4, 4]')
    );

    await runTest('3D Animated Vector Field Streamlines Default', () =>
        handlePlotCommand('F(x,y,z) = (-y, x, z/2) view:3d kind:vector vars:{x, y, z} camera:z x:[-4, 4] y:[-4, 4] z:[-4, 4]')
    );

    await runTest('3D Evolution Vector Field Streamlines Sweep', () =>
        handlePlotCommand('F(x,y,z) = (-y, x, a*z/2) view:3d kind:vector vars:{x, y, z} animate:a x:[-4, 4] y:[-4, 4] z:[-4, 4] a:[0, 2]')
    );

    await runTest('3D Evolution Vector Field Spherical Sweep over Phi', () =>
        handlePlotCommand('F(r, theta, phi) = (1/(r^2 + 0.1), 0.25*sin(phi), 0) view:3d kind:vector vars:{r, theta, phi} animate:phi r:[1, 5] theta:[0, pi] phi:[0, 2*pi]')
    );

    console.log('\nShutting down renderer...');
    await renderer.close();
    console.log('--- DONE ---');
}

runTests().catch(err => {
    console.error('Fatal error during test run:', err);
});
