const assert = require('assert');
const fs = require('fs');

const { runStartupProbe } = require('../bot');
const { createHarness } = require('./test-harness');

const harness = createHarness('STARTUP TESTS');

async function runTests() {
    console.log('--- STARTING STARTUP TESTS ---');

    await harness.runTest('Bot startup probe validates runtime wiring without a live WhatsApp login', async () => {
        const result = await runStartupProbe({
            logSummary: false,
            verifyRenderer: true
        });

        assert.equal(result.success, true, 'expected startup probe success');
        assert.equal(result.clientConstructed, true, 'expected client construction to succeed');
        assert.equal(result.rendererVerified, true, 'expected renderer startup verification to succeed');
        assert.ok(result.runtimePaths, 'expected runtime paths in startup probe result');
        assert.ok(fs.existsSync(result.runtimePaths.whatsappAuthDir), 'expected WhatsApp auth directory to exist');
        assert.ok(fs.existsSync(result.runtimePaths.whatsappCacheDir), 'expected WhatsApp cache directory to exist');
        assert.ok(fs.existsSync(result.runtimePaths.rendererCacheDir), 'expected renderer cache directory to exist');
        assert.ok(result.sessionDirPath, 'expected a WhatsApp session directory path');
    });

    harness.finish();
}

runTests().catch((err) => {
    console.error('Fatal error during startup tests:', err);
    process.exit(1);
});
