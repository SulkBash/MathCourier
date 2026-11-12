const https = require('https');

// Bound the whole request, including response download, so a stalled service
// cannot occupy a renderer worker indefinitely.
function requestBuffer(options, { body, timeoutMs, maxBytes }) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let timer;
        let request;

        function finish(error, value) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) reject(error);
            else resolve(value);
        }

        try {
            request = https.request(options, (response) => {
                response.on('error', (error) => finish(error));
                response.on('aborted', () => finish(new Error('Response was interrupted.')));

                if (response.statusCode !== 200) {
                    response.resume();
                    finish(new Error(`HTTP ${response.statusCode}`));
                    return;
                }

                const chunks = [];
                let size = 0;
                response.on('data', (chunk) => {
                    if (settled) return;
                    size += chunk.length;
                    if (size > maxBytes) {
                        finish(new Error('Response size limit exceeded.'));
                        response.destroy();
                        return;
                    }
                    chunks.push(chunk);
                });
                response.on('end', () => finish(null, Buffer.concat(chunks)));
            });

            request.on('error', (error) => finish(error));
            timer = setTimeout(() => {
                finish(new Error('Request timed out.'));
                request.destroy();
            }, timeoutMs);
            request.end(body);
        } catch (error) {
            finish(error);
            if (request) request.destroy();
        }
    });
}

module.exports = { requestBuffer };
