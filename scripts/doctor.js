const fs = require('fs');
const path = require('path');

const config = require('../config');
const {
    getConfiguredBrowserExecutablePath,
    getWhatsAppSessionDir,
    probeFfmpegCommand,
    resolvePuppeteerLaunchOptions,
    resolvePythonCommand,
    resolveRuntimePaths
} = require('../src/runtime');
const { runStartupProbe } = require('../bot');

const minimumNodeMajor = 20;
const maximumNodeMajor = 24;
const verifiedNodeVersion = '20.19.5';
const runtimePaths = resolveRuntimePaths();

function pass(label, detail) {
    return { level: 'PASS', label, detail, required: true };
}

function warn(label, detail) {
    return { level: 'WARN', label, detail, required: false };
}

function fail(label, detail) {
    return { level: 'FAIL', label, detail, required: true };
}

function formatResult(result) {
    return `[${result.level}] ${result.label}: ${result.detail}`;
}

function testWritableDirectory(label, fullPath, options = {}) {
    try {
        if (!fs.existsSync(fullPath)) {
            if (!options.createIfMissing) {
                return fail(label, `Missing path: ${fullPath}`);
            }
            fs.mkdirSync(fullPath, { recursive: true });
        }

        const probePath = path.join(fullPath, '.doctor-write-test');
        fs.writeFileSync(probePath, 'ok', 'utf8');
        fs.unlinkSync(probePath);
        return pass(label, `Writable at ${fullPath}`);
    } catch (error) {
        return fail(label, `Not writable: ${fullPath} (${error.message})`);
    }
}

function checkNode() {
    const version = process.versions.node;
    const major = Number(version.split('.')[0]);

    if (!Number.isInteger(major)) {
        return fail('Node.js', `Could not determine the Node.js major version from ${version}`);
    }

    if (major < minimumNodeMajor || major > maximumNodeMajor) {
        return fail('Node.js', `Expected Node ${minimumNodeMajor}.x through ${maximumNodeMajor}.x for this repo, found ${version}`);
    }

    if (version === verifiedNodeVersion) {
        return pass('Node.js', `Detected ${version}`);
    }

    return pass(
        'Node.js',
        `Detected ${version}. Supported majors are ${minimumNodeMajor}.x through ${maximumNodeMajor}.x; CI baseline remains ${verifiedNodeVersion}.`
    );
}

function checkPythonInterpreter() {
    const python = resolvePythonCommand({ refresh: true });
    if (!python) {
        return {
            interpreter: null,
            result: fail('Python 3', 'No working Python 3 interpreter found. Install Python 3 or set PYTHON_BIN/runtime.pythonBin.')
        };
    }

    return {
        interpreter: python,
        result: pass('Python 3', `Detected via ${python.label}: ${python.version}`)
    };
}

function checkPythonPackages(python) {
    if (!python) {
        return fail('Python packages', 'Skipped because no Python interpreter was found.');
    }

    const script = [
        'import importlib.util, json',
        'names = ["sympy", "numpy", "scipy"]',
        'missing = [name for name in names if importlib.util.find_spec(name) is None]',
        'versions = {}',
        'for name in names:',
        '    if name not in missing:',
        '        module = __import__(name)',
        '        versions[name] = getattr(module, "__version__", "unknown")',
        'print(json.dumps({"missing": missing, "versions": versions}))'
    ].join('\n');

    const { spawnSync } = require('child_process');
    const result = spawnSync(python.command, [...(python.args || []), '-c', script], {
        encoding: 'utf8',
        timeout: 10000
    });

    if (result.error || result.status !== 0) {
        return fail('Python packages', `Package probe failed: ${(result.error && result.error.message) || result.stderr || 'unknown error'}`);
    }

    try {
        const parsed = JSON.parse((result.stdout || '').trim() || '{}');
        if (Array.isArray(parsed.missing) && parsed.missing.length > 0) {
            return fail('Python packages', `Missing ${parsed.missing.join(', ')}. Install with: pip install sympy numpy scipy`);
        }

        const versions = parsed.versions || {};
        return pass(
            'Python packages',
            `sympy ${versions.sympy || 'unknown'}, numpy ${versions.numpy || 'unknown'}, scipy ${versions.scipy || 'unknown'}`
        );
    } catch (error) {
        return fail('Python packages', `Could not parse package probe output: ${error.message}`);
    }
}

async function checkPuppeteer() {
    try {
        const puppeteer = require('puppeteer');
        const browser = await puppeteer.launch(resolvePuppeteerLaunchOptions(config.puppeteer.launchArgs));
        const page = await browser.newPage();
        await page.close();
        await browser.close();
        return pass('Puppeteer/Chromium', 'Headless browser launched successfully.');
    } catch (error) {
        return fail('Puppeteer/Chromium', error.message);
    }
}

function checkBrowserOverride() {
    const browserExecutablePath = getConfiguredBrowserExecutablePath();
    if (!browserExecutablePath) {
        return warn('Chromium/Chrome executable override', 'Using Puppeteer default browser resolution. Set PUPPETEER_EXECUTABLE_PATH or runtime.browserExecutablePath when the host browser lives in a custom location.');
    }

    return pass('Chromium/Chrome executable override', browserExecutablePath);
}

function checkFfmpeg() {
    const ffmpeg = probeFfmpegCommand();
    if (!ffmpeg) {
        return warn('ffmpeg', 'Not found. Animated 3D renders will fall back to a static image. Install ffmpeg or set FFMPEG_BIN/runtime.ffmpegBin.');
    }

    const firstLine = ffmpeg.version.split(/\r?\n/)[0];
    return pass('ffmpeg', firstLine);
}

async function checkBotBootstrap() {
    try {
        const result = await runStartupProbe({
            logSummary: false,
            verifyRenderer: false
        });

        if (!result.clientConstructed) {
            return fail('Bot bootstrap', 'Client construction did not complete.');
        }

        return pass('Bot bootstrap', 'Client options, runtime directories, and startup wiring resolved successfully.');
    } catch (error) {
        return fail('Bot bootstrap', error.message);
    }
}

async function main() {
    const results = [];

    results.push(checkNode());

    const pythonCheck = checkPythonInterpreter();
    results.push(pythonCheck.result);
    results.push(checkPythonPackages(pythonCheck.interpreter));

    results.push(pass('WhatsApp session dir', getWhatsAppSessionDir()));
    results.push(testWritableDirectory('WhatsApp auth root', runtimePaths.whatsappAuthDir, { createIfMissing: true }));
    results.push(testWritableDirectory('WhatsApp web cache', runtimePaths.whatsappCacheDir, { createIfMissing: true }));
    results.push(testWritableDirectory('Renderer cache', runtimePaths.rendererCacheDir, { createIfMissing: true }));
    results.push(testWritableDirectory('test_output', path.join(runtimePaths.repoRoot, 'test_output'), { createIfMissing: true }));

    results.push(checkBrowserOverride());
    results.push(await checkPuppeteer());
    results.push(checkFfmpeg());
    results.push(await checkBotBootstrap());

    console.log('MathCourier setup check');
    console.log('This project is intentionally terminal-first. Use this command before QR auth or full startup.');
    console.log('The release gate is designed to stay portable across Windows, Linux, and macOS; WhatsApp QR auth still requires a real account outside automation.');
    console.log('');

    for (const result of results) {
        console.log(formatResult(result));
    }

    const failures = results.filter((result) => result.level === 'FAIL' && result.required);
    const warnings = results.filter((result) => result.level === 'WARN');

    console.log('');
    if (failures.length > 0) {
        console.log(`Doctor found ${failures.length} required issue(s) and ${warnings.length} warning(s).`);
        process.exitCode = 1;
        return;
    }

    console.log(`Doctor passed with ${warnings.length} warning(s).`);
}

main().catch((error) => {
    console.error('[FAIL] doctor:', error.message);
    process.exit(1);
});
