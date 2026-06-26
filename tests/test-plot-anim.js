const handlePlotCommand = require('../src/commands/plot');
const { createHarness } = require('./test-harness');

const harness = createHarness('UNSUPPORTED 2D PLOT ANIMATION TESTS');

const unsupported2dAnimationCases = [
    {
        name: '1. Explicit Curve Tracing (-e[x])',
        input: '-e[x] y = sin(x) [-10, 10]',
        errorIncludes: ['Legacy 2D -e[...] animation syntax is no longer supported.']
    },
    {
        name: '2. Explicit Curve Tracing along Y (-e[y])',
        input: '-e[y] y = 2*x [-5, 5]',
        errorIncludes: ['Legacy 2D -e[...] animation syntax is no longer supported.']
    },
    {
        name: '3. Explicit Curve Parameter Sweep (traveling wave -e[t])',
        input: '-e[t] y = sin(x - t) [-10, 10] [0, 2*pi]',
        errorIncludes: ['Legacy 2D -e[...] animation syntax is no longer supported.']
    },
    {
        name: '4. Parametric Curve Tracing (-et)',
        input: '-et (cos(t), sin(t)) [0, 2*pi]',
        errorIncludes: ['Legacy 2D -e[...] animation syntax is no longer supported.']
    },
    {
        name: '5. Parametric Curve Parameter Sweep (-e[a])',
        input: '-e[a] (2*cos(t - a), sin(t - a)) [0, 2*pi] [0, 2*pi]',
        errorIncludes: ['Legacy 2D -e[...] animation syntax is no longer supported.']
    },
    {
        name: '6. Polar Curve Tracing (-e[theta])',
        input: '-e[theta] r = 2 * (1 - cos(theta)) [0, 2*pi]',
        errorIncludes: ['Legacy 2D -e[...] animation syntax is no longer supported.']
    },
    {
        name: '7. Vector Field Tracing (-ex)',
        input: '-ex v(x,y) = (-y, x) [-5, 5] [-5, 5]',
        errorIncludes: ['Legacy 2D -e[...] animation syntax is no longer supported.']
    },
    {
        name: '8. Modern 2D Parameter Sweep (animate:t without view:3d)',
        input: 'y = sin(x - t) animate:t x:[-10, 10] y:[-2, 2] t:[0, 2*pi]',
        errorIncludes: ['2D animation is not supported in !plot.']
    },
    {
        name: '9. Modern 2D Vector Tracing (animate:x without view:3d)',
        input: '(-y, x) kind:vector animate:x x:[-5, 5] y:[-5, 5]',
        errorIncludes: ['2D animation is not supported in !plot.']
    }
];

async function runTests() {
    console.log('=== STARTING UNSUPPORTED 2D PLOT ANIMATION TESTS ===\n');
    console.log('2D animation is intentionally outside the current public !plot surface; these inputs should fail clearly and consistently.\n');

    for (const tc of unsupported2dAnimationCases) {
        await harness.runTest(tc.name, async () => {
            console.log(`Command input: "${tc.input}"`);
            const renderRes = await handlePlotCommand(tc.input);
            harness.expectFailure(renderRes, tc.errorIncludes);
            console.log('--------------------------------------------');
        });
    }

    harness.finish();
}

runTests().catch((err) => {
    console.error('Fatal unsupported 2D animation test error:', err);
    process.exit(1);
});
