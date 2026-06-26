const path = require('path');
const { spawnSync } = require('child_process');

const config = require('../config');

const REPO_ROOT = path.resolve(__dirname, '..');

let cachedPythonCommand;

function trimCommandOutput(result) {
    return `${result.stdout || ''}${result.stderr || ''}`.trim();
}

function getRuntimeConfig() {
    return config.runtime || {};
}

function resolveRepoPath(rawPath, fallbackRelativePath) {
    const targetPath = rawPath || fallbackRelativePath;
    if (!targetPath) {
        return null;
    }

    if (path.isAbsolute(targetPath)) {
        return targetPath;
    }

    return path.resolve(REPO_ROOT, targetPath);
}

function resolveRuntimePaths() {
    const runtimeConfig = getRuntimeConfig();

    return {
        repoRoot: REPO_ROOT,
        whatsappAuthDir: resolveRepoPath(runtimeConfig.whatsappAuthPath, '.wwebjs_auth'),
        whatsappCacheDir: resolveRepoPath(runtimeConfig.whatsappCachePath, '.wwebjs_cache'),
        rendererCacheDir: resolveRepoPath(runtimeConfig.rendererCachePath, path.join('runtime_cache', 'renderer'))
    };
}

function getWhatsAppClientId() {
    return getRuntimeConfig().whatsappClientId || null;
}

function getWhatsAppSessionDir() {
    const { whatsappAuthDir } = resolveRuntimePaths();
    const clientId = getWhatsAppClientId();
    const sessionDirName = clientId ? `session-${clientId}` : 'session';
    return path.join(whatsappAuthDir, sessionDirName);
}

function getWhatsAppLocalAuthOptions() {
    return {
        dataPath: resolveRuntimePaths().whatsappAuthDir,
        clientId: getWhatsAppClientId() || undefined
    };
}

function getWhatsAppWebCacheOptions() {
    return {
        type: 'local',
        path: resolveRuntimePaths().whatsappCacheDir
    };
}

function getConfiguredBotName() {
    return getRuntimeConfig().botName || null;
}

function getBotIdentityPath() {
    const configuredPath = getRuntimeConfig().botIdentityPath || null;
    if (configuredPath) {
        return resolveRepoPath(configuredPath, null);
    }

    const { rendererCacheDir } = resolveRuntimePaths();
    const clientId = getWhatsAppClientId() || 'default';
    return path.join(rendererCacheDir, `bot-profile-${clientId}.json`);
}

function getConfiguredBrowserExecutablePath() {
    return resolveRepoPath(getRuntimeConfig().browserExecutablePath, null);
}

function resolvePuppeteerLaunchOptions(baseLaunchArgs = {}) {
    const launchArgs = {
        ...baseLaunchArgs
    };

    if (Array.isArray(baseLaunchArgs.args)) {
        launchArgs.args = [...baseLaunchArgs.args];
    }

    const executablePath = getConfiguredBrowserExecutablePath();
    if (executablePath) {
        launchArgs.executablePath = executablePath;
    }

    return launchArgs;
}

function getConfiguredPythonCommand() {
    return getRuntimeConfig().pythonBin || null;
}

function getConfiguredFfmpegCommand() {
    return getRuntimeConfig().ffmpegBin || null;
}

function dedupeSpecs(specs) {
    const seen = new Set();
    return specs.filter((spec) => {
        const key = `${spec.command}::${(spec.args || []).join(' ')}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function getPythonCandidateSpecs() {
    const specs = [];
    const configuredPythonCommand = getConfiguredPythonCommand();

    if (configuredPythonCommand) {
        specs.push({
            label: process.env.PYTHON_BIN ? 'PYTHON_BIN' : 'runtime.pythonBin',
            command: configuredPythonCommand,
            args: []
        });
    }

    if (process.platform === 'win32') {
        specs.push(
            { label: 'py -3', command: 'py', args: ['-3'] },
            { label: 'python', command: 'python', args: [] },
            { label: 'python3', command: 'python3', args: [] }
        );
    } else {
        specs.push(
            { label: 'python3', command: 'python3', args: [] },
            { label: 'python', command: 'python', args: [] }
        );
    }

    return dedupeSpecs(specs);
}

function probeCommand(spec, versionArgs = ['--version']) {
    const result = spawnSync(spec.command, [...(spec.args || []), ...versionArgs], {
        encoding: 'utf8',
        timeout: 10000
    });

    if (result.error || result.status !== 0) {
        return null;
    }

    return {
        ...spec,
        version: trimCommandOutput(result) || 'Unknown version'
    };
}

function resolvePythonCommand(options = {}) {
    if (!options.refresh && cachedPythonCommand) {
        return cachedPythonCommand;
    }

    for (const spec of getPythonCandidateSpecs()) {
        const probed = probeCommand(spec);
        if (probed) {
            cachedPythonCommand = probed;
            return probed;
        }
    }

    cachedPythonCommand = null;
    return null;
}

function getFfmpegCommand() {
    return getConfiguredFfmpegCommand() || 'ffmpeg';
}

function probeFfmpegCommand() {
    return probeCommand({
        label: getConfiguredFfmpegCommand()
            ? (process.env.FFMPEG_BIN ? 'FFMPEG_BIN' : 'runtime.ffmpegBin')
            : 'ffmpeg',
        command: getFfmpegCommand(),
        args: []
    }, ['-version']);
}

module.exports = {
    getBotIdentityPath,
    getConfiguredBrowserExecutablePath,
    getConfiguredBotName,
    getWhatsAppClientId,
    getWhatsAppLocalAuthOptions,
    getWhatsAppSessionDir,
    getWhatsAppWebCacheOptions,
    getFfmpegCommand,
    getPythonCandidateSpecs,
    probeCommand,
    probeFfmpegCommand,
    resolvePuppeteerLaunchOptions,
    resolvePythonCommand,
    resolveRuntimePaths
};
