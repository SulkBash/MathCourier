const https = require('https');
const config = require('../../config');

async function renderFallback(formula) {
    return new Promise((resolve) => {
        try {
            const bgHex = config.style.backgroundColor.replace('#', '');
            const textHex = config.style.textColor.replace('#', '');
            const escaped = encodeURIComponent(formula);
            const apiUrl = `https://latex.codecogs.com/png.image?\\dpi{200}\\bg{${bgHex}}\\color{${textHex}}${escaped}`;
            
            https.get(apiUrl, (res) => {
                if (res.statusCode !== 200) {
                    resolve({ success: false, error: `Web API returned status code ${res.statusCode}` });
                    return;
                }

                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const buffer = Buffer.concat(chunks);
                    resolve({ success: true, data: buffer.toString('base64'), source: 'fallback-api' });
                });
            }).on('error', (err) => {
                resolve({ success: false, error: `Network error on Web API request: ${err.message}` });
            });
        } catch (err) {
            resolve({ success: false, error: `Web API preparation failed: ${err.message}` });
        }
    });
}

module.exports = {
    renderFallback
};
