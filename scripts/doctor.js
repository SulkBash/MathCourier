const fs = require('fs');
const path = require('path');

const config = require('../config');
const { probeFfmpegCommand, resolvePythonCommand } = require('../src/runtime');

const repoRoot = path.resolve(__dirname, '..');
const requiredNodeMajor = 20;

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

function testWritableDirectory(relativeDir, options = {}) {
    const fullPath = path.join(repoRoot, relativeDir);

    try {
        if (!fs.existsSync(fullPath)) {
            if (!options.createIfMissing) {
                return fail(relativeDir, `Missing path: ${fullPath}`);
            }
            fs.mkdirSync(fullPath, { recursive: true });
        }

        const probePath = path.join(fullPath, '.doctor-write-test');
        fs.writeFileSync(probePath, 'ok', 'utf8');
        fs.unlinkSync(probePath);
        return pass(relativeDir, `Writable at ${fullPath}`);
    } catch (error) {
        return fail(relativeDir, `Not writable: ${fullPath} (${error.message})`);
    }
}

function checkNode() {
    const version = process.versions.node;
    const major = Number(version.split('.')[0]);

    if (major !== requiredNodeMajor) {
        return fail('Node.js', `Expected Node ${requiredNodeMajor}.x for this repo, found ${version}`);
    }

    return pass('Node.js', `Detected ${version}`);
}

function checkPythonInterpreter() {
    const python = resolvePythonCommand({ refresh: true });
    if (!python) {
        return {
            interpreter: null,
            result: fail('Python 3', 'No working Python 3 interpreter found. Install Python 3 or set PYTHON_BIN.')
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
        const browser = await puppeteer.launch(config.puppeteer.launchArgs);
        const page = await browser.newPage();
        await page.close();
        await browser.close();
        return pass('Puppeteer/Chromium', 'Headless browser launched successfully.');
    } catch (error) {
        return fail('Puppeteer/Chromium', error.message);
    }
}

function checkFfmpeg() {
    const ffmpeg = probeFfmpegCommand();
    if (!ffmpeg) {
        return warn('ffmpeg', 'Not found on PATH. Animated 3D renders will fall back to a static image.');
    }

    const firstLine = ffmpeg.version.split(/\r?\n/)[0];
    return pass('ffmpeg', firstLine);
}

async function main() {
    const results = [];

    results.push(checkNode());

    const pythonCheck = checkPythonInterpreter();
    results.push(pythonCheck.result);
    results.push(checkPythonPackages(pythonCheck.interpreter));

    results.push(testWritableDirectory('.wwebjs_auth', { createIfMissing: true }));
    results.push(testWritableDirectory('.wwebjs_cache', { createIfMissing: true }));
    results.push(testWritableDirectory('test_output', { createIfMissing: true }));
    results.push(testWritableDirectory(path.join('node_modules', 'katex', 'dist')));

    results.push(await checkPuppeteer());
    results.push(checkFfmpeg());

    console.log('LaTeX Render Bot setup check');
    console.log('This project is intentionally terminal-first. Use this command before QR auth or full startup.');
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
