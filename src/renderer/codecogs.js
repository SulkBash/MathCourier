const config = require('../../config');
const { requestBuffer } = require('./http');

async function renderFallback(formula) {
    try {
        const bgHex = config.style.backgroundColor.replace('#', '');
        const textHex = config.style.textColor.replace('#', '');
        const escaped = encodeURIComponent(formula);
        const apiUrl = `https://latex.codecogs.com/png.image?\\dpi{200}\\bg{${bgHex}}\\color{${textHex}}${escaped}`;
        const buffer = await requestBuffer(apiUrl, {
            timeoutMs: config.runtime.externalRendererTimeoutMs,
            maxBytes: config.runtime.externalRendererMaxImageBytes
        });
        return { success: true, data: buffer.toString('base64'), source: 'fallback-api' };
    } catch (err) {
        return { success: false, error: `Network error on Web API request: ${err.message}` };
    }
}

module.exports = {
    renderFallback
};
