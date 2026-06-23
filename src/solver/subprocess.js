const { spawn } = require('child_process');
const path = require('path');
const { preprocessCalculusHelpers } = require('../utils');

const SUBPROCESS_TIMEOUT_MS = 30000;
const SUBPROCESS_MAX_STDOUT = 512 * 1024;

function preprocessPayload(obj) {
    if (typeof obj === 'string') {
        return preprocessCalculusHelpers(obj);
    }
    if (Array.isArray(obj)) {
        return obj.map(preprocessPayload);
    }
    if (obj !== null && typeof obj === 'object') {
        const result = {};
        for (const key of Object.keys(obj)) {
            result[key] = preprocessPayload(obj[key]);
        }
        return result;
    }
    return obj;
}

function runSubprocess(scriptPath, payload) {
    return new Promise((resolve) => {
        let stdoutData = '';
        let stderrData = '';
        let settled = false;

        const pyProcess = spawn('python', [scriptPath]);

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            try {
                pyProcess.kill('SIGKILL');
            } catch (_) {}
            resolve({ success: false, error: 'Computation timed out (max 30 s). Try a simpler expression.' });
        }, SUBPROCESS_TIMEOUT_MS);

        pyProcess.stdout.on('data', (data) => {
            stdoutData += data.toString();
            if (stdoutData.length > SUBPROCESS_MAX_STDOUT) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                try {
                    pyProcess.kill('SIGKILL');
                } catch (_) {}
                resolve({ success: false, error: 'Solver output limit exceeded.' });
            }
        });

        pyProcess.stderr.on('data', (data) => {
            stderrData += data.toString();
        });

        pyProcess.on('close', (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);

            if (code !== 0) {
                console.error(`Python [${path.basename(scriptPath)}] exited with code ${code}. Stderr: ${stderrData}`);
                return resolve({ success: false, error: 'Internal solver error. The expression may be malformed or unsupported.' });
            }

            try {
                const response = JSON.parse(stdoutData.trim());
                resolve(response);
            } catch (err) {
                console.error('Failed to parse Python output:', stdoutData);
                resolve({ success: false, error: `Failed to parse solver response: ${err.message}` });
            }
        });

        const preprocessedPayload = preprocessPayload(payload);
        pyProcess.stdin.write(JSON.stringify(preprocessedPayload));
        pyProcess.stdin.end();
    });
}

module.exports = {
    runSubprocess
};
