const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '../test_output');

function ensureOutputDir() {
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    return OUTPUT_DIR;
}

function getExtension(result) {
    if (result.mimeType === 'video/mp4') {
        return '.mp4';
    }
    if (result.mimeType === 'image/jpeg') {
        return '.jpg';
    }
    return '.png';
}

function toFilename(name, extension) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '') + extension;
}

function expectSuccess(result, message = 'Expected a successful result.') {
    if (!result || result.success !== true) {
        throw new Error((result && result.error) || message);
    }

    return result;
}

function expectMediaSuccess(result, message = 'Expected a successful media result.') {
    expectSuccess(result, message);

    if (!result.data) {
        throw new Error('Expected result data payload.');
    }

    return result;
}

function expectFailure(result, expectedSnippets = []) {
    if (!result || result.success !== false) {
        throw new Error('Expected a failure result.');
    }

    const errorText = String(result.error || 'Unknown error');
    for (const snippet of expectedSnippets) {
        if (!errorText.includes(snippet)) {
            throw new Error(`Expected error to include "${snippet}", got: ${errorText}`);
        }
    }

    console.log(`  ok (expected error): ${errorText}`);
    return result;
}

function writeResult(name, result, outputDir = OUTPUT_DIR) {
    ensureOutputDir();

    const extension = getExtension(result);
    const outPath = path.join(outputDir, toFilename(name, extension));
    fs.writeFileSync(outPath, Buffer.from(result.data, 'base64'));
    console.log(`  ok (${result.source}) -> ${outPath}`);
    return outPath;
}

function createHarness(suiteLabel) {
    let failures = 0;

    function markFailure(message) {
        failures += 1;
        process.exitCode = 1;
        console.error(message);
    }

    async function runTest(name, fn) {
        console.log(`\n${name}`);

        try {
            await fn();
        } catch (error) {
            markFailure(`  FAIL: ${error.message}`);
        }
    }

    function runAssertion(name, fn) {
        console.log(`\n${name}`);

        try {
            fn();
            console.log('  ok');
        } catch (error) {
            markFailure(`  FAIL: ${error.message}`);
        }
    }

    function finish() {
        if (failures > 0) {
            console.error(`--- ${suiteLabel} FAILED (${failures} failure${failures === 1 ? '' : 's'}) ---`);
        } else {
            console.log(`--- ${suiteLabel} PASSED ---`);
        }
    }

    return {
        ensureOutputDir,
        expectFailure,
        expectMediaSuccess,
        expectSuccess,
        finish,
        markFailure,
        runAssertion,
        runTest,
        writeResult
    };
}

module.exports = {
    OUTPUT_DIR,
    createHarness,
    ensureOutputDir,
    expectFailure,
    expectMediaSuccess,
    expectSuccess,
    writeResult
};
