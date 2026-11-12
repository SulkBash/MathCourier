const url = require('url');
const config = require('../../config');
const { requestBuffer } = require('./http');

const QUICKLATEX_ALLOWED_HOSTS = new Set(['quicklatex.com', 'www.quicklatex.com']);

function parseQuickLaTeXResponse(body) {
    const lines = String(body || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    if (lines.length === 0) {
        return { success: false, error: 'QuickLaTeX returned an empty response.' };
    }

    if (lines[0] !== '0') {
        const detail = lines.slice(1).join(' ').trim();
        return {
            success: false,
            error: `QuickLaTeX error: ${detail || `status ${lines[0]}`}`
        };
    }

    if (!lines[1]) {
        return { success: false, error: 'QuickLaTeX returned a success code without an image URL.' };
    }

    const responseParts = lines[1].split(/\s+/).filter(Boolean);
    const imageUrl = responseParts[0];
    const detail = lines.slice(2).join(' ').trim();

    let reportedWidth = null;
    let reportedHeight = null;
    if (responseParts.length >= 3) {
        const maybeWidth = Number(responseParts[responseParts.length - 2]);
        const maybeHeight = Number(responseParts[responseParts.length - 1]);
        if (Number.isFinite(maybeWidth) && Number.isFinite(maybeHeight)) {
            reportedWidth = maybeWidth;
            reportedHeight = maybeHeight;
        }
    }

    try {
        const parsedUrl = new url.URL(imageUrl);
        if (/\/error\.png$/i.test(parsedUrl.pathname)) {
            return {
                success: false,
                error: `QuickLaTeX error: ${detail || 'QuickLaTeX returned its error image.'}`
            };
        }
    } catch (_) {
        // Let the existing URL validation path report invalid URLs below.
    }

    if (reportedWidth === 1 && reportedHeight === 1) {
        return {
            success: false,
            error: 'QuickLaTeX returned an empty 1x1 image. The input likely failed to compile.'
        };
    }

    return {
        success: true,
        imageUrl,
        reportedWidth,
        reportedHeight
    };
}

async function renderQuickLaTeX(formula, preamble, renderPage = null) {
    const textHex = config.style.textColor.replace('#', '').toUpperCase();
    // QuickLaTeX expects TeX commands and line breaks verbatim. Escape form
    // delimiters and plus signs, which form decoders otherwise turn into spaces.
    const encodeField = (value) => value.replace(/[%&+]/g, (char) => ({
        '%': '%25', '&': '%26', '+': '%2B'
    })[char]);
    const postData = `formula=${encodeField(formula)}&preamble=${encodeField(preamble)}&fsize=18px&fcolor=${textHex}&mode=0&out=1&remhost=quicklatex.com`;

    let response;
    try {
        response = await requestBuffer({
            hostname: 'quicklatex.com',
            port: 443,
            path: '/latex3.f',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        }, {
            body: postData,
            timeoutMs: config.runtime.externalRendererTimeoutMs,
            maxBytes: config.runtime.externalRendererMaxResponseBytes
        });
    } catch (err) {
        return { success: false, error: `QuickLaTeX connection error: ${err.message}` };
    }

    const parsedResponse = parseQuickLaTeXResponse(response.toString('utf8'));
    if (!parsedResponse.success) return parsedResponse;

    // SSRF guard: only fetch HTTPS images from the known QuickLaTeX hosts.
    let imageUrl;
    try {
        imageUrl = new url.URL(parsedResponse.imageUrl);
    } catch (_) {
        return { success: false, error: 'QuickLaTeX returned an invalid image URL.' };
    }
    if (imageUrl.protocol !== 'https:' || !QUICKLATEX_ALLOWED_HOSTS.has(imageUrl.hostname) ||
        imageUrl.port || imageUrl.username || imageUrl.password) {
        return { success: false, error: 'QuickLaTeX returned an image URL from an unexpected host.' };
    }

    let b64;
    try {
        const image = await requestBuffer(imageUrl, {
            timeoutMs: config.runtime.externalRendererTimeoutMs,
            maxBytes: config.runtime.externalRendererMaxImageBytes
        });
        b64 = image.toString('base64');
    } catch (err) {
        return { success: false, error: `Failed to fetch image data: ${err.message}` };
    }

    const katexModule = require('./katex');
    const page = renderPage || katexModule.getPage();
    if (!katexModule.isInitialized() || !page) {
        return { success: true, data: b64, source: 'quicklatex-raw' };
    }

    try {
        // Use DOM APIs and wait for the image to decode before taking the screenshot.
        await page.evaluate(async (encodedImage) => {
            const mathDiv = document.getElementById('math');
            while (mathDiv.firstChild) mathDiv.removeChild(mathDiv.firstChild);
            const img = document.createElement('img');
            img.src = `data:image/png;base64,${encodedImage}`;
            img.style.display = 'block';
            img.style.maxWidth = '100%';
            img.style.height = 'auto';
            mathDiv.appendChild(img);
            await img.decode();
        }, b64);

        const card = await page.$('#card');
        const screenshot = await card.screenshot({ type: 'png', omitBackground: true });
        return { success: true, data: screenshot.toString('base64'), source: 'quicklatex-card' };
    } catch (err) {
        return { success: false, error: `Error during card screenshot generation: ${err.message}` };
    }
}

function renderChem(formula, renderPage = null) {
    const textHex = config.style.textColor.replace('#', '').toUpperCase();
    const preamble = [
        '\\usepackage{xcolor}',
        `\\definecolor{fgcolor}{HTML}{${textHex}}`,
        '\\usepackage{chemfig}',
        '\\setchemfig{bond style={color=fgcolor}}',
        '\\renewcommand*\\printatom[1]{\\color{fgcolor}\\ensuremath{\\mathrm{#1}}}'
    ].join('\n');
    return renderQuickLaTeX(formula, preamble, renderPage);
}

function renderTikz(formula, renderPage = null) {
    const textHex = config.style.textColor.replace('#', '').toUpperCase();
    const preamble = [
        '\\usepackage{xcolor}',
        `\\definecolor{fgcolor}{HTML}{${textHex}}`,
        '\\usepackage{tikz}',
        '\\usepackage{circuitikz}',
        '\\usetikzlibrary{shapes,arrows,positioning,calc,fit,backgrounds}',
        '\\tikzset{every picture/.style={color=fgcolor}}',
        '\\tikzset{every node/.style={text=fgcolor}}'
    ].join('\n');

    let full = formula.trim();
    if (!full.includes('\\begin{tikzpicture}')) {
        full = `\\begin{tikzpicture}\n${full}\n\\end{tikzpicture}`;
    }

    return renderQuickLaTeX(full, preamble, renderPage);
}

module.exports = {
    renderChem,
    renderTikz,
    renderQuickLaTeX,
    parseQuickLaTeXResponse
};
