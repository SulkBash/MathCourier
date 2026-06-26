const { spawnSync } = require('child_process');

let cachedPythonCommand;

function trimCommandOutput(result) {
    return `${result.stdout || ''}${result.stderr || ''}`.trim();
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

    if (process.env.PYTHON_BIN) {
        specs.push({
            label: 'PYTHON_BIN',
            command: process.env.PYTHON_BIN,
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
    return process.env.FFMPEG_BIN || 'ffmpeg';
}

function probeFfmpegCommand() {
    return probeCommand({
        label: process.env.FFMPEG_BIN ? 'FFMPEG_BIN' : 'ffmpeg',
        command: getFfmpegCommand(),
        args: []
    }, ['-version']);
}

module.exports = {
    getFfmpegCommand,
    getPythonCandidateSpecs,
    probeCommand,
    probeFfmpegCommand,
    resolvePythonCommand
};
