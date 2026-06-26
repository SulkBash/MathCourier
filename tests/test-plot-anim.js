const assert = require('assert');
const renderer = require('../src/renderer');
const handlePlotCommand = require('../src/commands/plot');
const { createHarness } = require('./test-harness');

const harness = createHarness('2D PLOT ANIMATION TESTS');

const animated2dCases = [
    {
        name: '1. Explicit Function Progressive Draw',
        input: 'y = sin(x) animate:x x:[-10, 10] y:[-2, 2]'
    },
    {
        name: '2. Explicit Function Parameter Sweep',
        input: 'y = sin(x - t) animate:t x:[-10, 10] y:[-2, 2] t:[0, 2*pi]'
    },
    {
        name: '3. Implicit Circle Progressive Draw',
        input: 'x^2 + y^2 = 9 animate:x x:[-4, 4] y:[-4, 4]'
    },
    {
        name: '4. Parametric Curve Progressive Draw',
        input: '(cos(3*t), sin(2*t)) kind:parametric animate:t t:[0, 2*pi] x:[-2, 2] y:[-2, 2]'
    },
    {
        name: '5. Polar Curve Progressive Draw',
        input: 'r = 1 + cos(theta) kind:polar animate:theta theta:[0, 2*pi] x:[-2.5, 2.5] y:[-2.5, 2.5]'
    },
    {
        name: '6. Vector Field Progressive Reveal',
        input: '(-y, x) kind:vector animate:x x:[-5, 5] y:[-5, 5]'
    },
    {
        name: '7. Vector Field Parameter Sweep',
        input: '(-a*y, a*x) kind:vector animate:a x:[-5, 5] y:[-5, 5] a:[0.25, 2]'
    }
];

function expectAnimatedPlotResult(result) {
    harness.expectMediaSuccess(result);
    assert(
        result.mimeType === 'video/mp4' || result.mimeType === 'image/jpeg',
        `Expected video/mp4 or image/jpeg, got ${result.mimeType || 'undefined'}`
    );
    assert(
        result.source === 'local-plot-2d-anim' || result.source === 'local-plot-2d-fallback',
        `Unexpected animation source: ${result.source || 'undefined'}`
    );

    if (result.mimeType === 'video/mp4') {
        assert.strictEqual(result.isAnimation, true, 'Expected MP4 results to be marked as animations.');
    }

    return result;
}

async function runTests() {
    console.log('=== STARTING 2D PLOT ANIMATION TESTS ===\n');

    await renderer.initialize();
    console.log(`Renderer status: ${renderer.isLocalReady() ? 'local ready' : 'local not ready'}`);
    harness.ensureOutputDir();

    try {
        for (const tc of animated2dCases) {
            await harness.runTest(tc.name, async () => {
                console.log(`Command input: "${tc.input}"`);
                const renderRes = await handlePlotCommand(tc.input);
                harness.writeResult(tc.name, expectAnimatedPlotResult(renderRes));
                console.log('--------------------------------------------');
            });
        }
    } finally {
        await renderer.close();
    }

    harness.finish();
}

runTests().catch((err) => {
    console.error('Fatal 2D animation test error:', err);
    process.exit(1);
});
