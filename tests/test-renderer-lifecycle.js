const assert = require('assert');
const fs = require('fs');
const path = require('path');

const renderer = require('../src/renderer');
const handlePlotCommand = require('../src/commands/plot');
const katexModule = require('../src/renderer/katex');
const { resolveRuntimePaths } = require('../src/runtime');
const { createHarness } = require('./test-harness');

const harness = createHarness('RENDERER LIFECYCLE TESTS');
const runtimePaths = resolveRuntimePaths();

function assertRuntimeTemplateState() {
    const templatePath = katexModule.getTemplatePath();
    assert.ok(templatePath, 'expected a runtime renderer template path');

    const normalizedTemplatePath = path.normalize(templatePath);
    assert.ok(
        normalizedTemplatePath.startsWith(path.normalize(runtimePaths.rendererCacheDir)),
        `expected renderer template under ${runtimePaths.rendererCacheDir}, got ${templatePath}`
    );
    assert.ok(
        !normalizedTemplatePath.includes(`${path.sep}node_modules${path.sep}`),
        `renderer template should not live inside node_modules: ${templatePath}`
    );
    assert.ok(fs.existsSync(templatePath), `expected runtime template file to exist: ${templatePath}`);

    const templateHtml = fs.readFileSync(templatePath, 'utf8');
    assert.ok(!templateHtml.includes('https://cdn.plot.ly/'), 'renderer template should not depend on the Plotly CDN');
    assert.ok(
        templateHtml.includes('plotly.js-dist-min'),
        'renderer template should reference the local Plotly runtime asset'
    );

    return templatePath;
}

async function runTests() {
    console.log('--- STARTING RENDERER LIFECYCLE TESTS ---');
    harness.ensureOutputDir();

    try {
        await harness.runTest('Renderer initialize/close cycles keep a stable runtime template', async () => {
            const seenTemplatePaths = [];

            for (let cycle = 0; cycle < 2; cycle++) {
                await renderer.initialize();
                assert.equal(renderer.isLocalReady(), true, `expected local renderer ready on cycle ${cycle + 1}`);

                const templatePath = assertRuntimeTemplateState();
                seenTemplatePaths.push(templatePath);

                await renderer.close();
                assert.equal(renderer.isLocalReady(), false, `expected closed renderer state on cycle ${cycle + 1}`);
                assert.ok(fs.existsSync(templatePath), 'expected runtime template file to persist across shutdown');
            }

            assert.equal(seenTemplatePaths[0], seenTemplatePaths[1], 'expected a stable runtime template path');
            await renderer.initialize();
            assert.equal(renderer.isLocalReady(), true, 'expected local renderer ready after the final reinitialize');
            assertRuntimeTemplateState();
        });

        await harness.runTest('3D render succeeds after shutdown and re-init', async () => {
            await renderer.close();
            await renderer.initialize();

            const result = await handlePlotCommand('z = sin(x) * cos(y) view:3d x:[-3, 3] y:[-3, 3]');
            harness.writeResult('Renderer lifecycle 3D reinit', harness.expectMediaSuccess(result));
        });

        await harness.runTest('Concurrent isolated 3D pages survive repeated reuse', async () => {
            const commands = [
                'z = sin(x) * cos(y) view:3d x:[-3, 3] y:[-3, 3]',
                '(sin(t), cos(t), t/2) view:3d kind:curve vars:{t} t:[0, 6*pi]',
                'x^2 + y^2 + z^2 = 1 view:3d x:[-2, 2] y:[-2, 2] z:[-2, 2]'
            ];

            const results = await Promise.all(commands.map((command) => handlePlotCommand(command)));
            results.forEach((result, index) => {
                harness.writeResult(
                    `Renderer lifecycle parallel 3D ${index + 1}`,
                    harness.expectMediaSuccess(result)
                );
            });
        });
    } finally {
        await renderer.close().catch(() => {});
        harness.finish();
    }
}

runTests().catch((err) => {
    console.error('Fatal error during renderer lifecycle tests:', err);
    process.exit(1);
});
