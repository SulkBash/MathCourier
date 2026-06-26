const https = require('https');
const url = require('url');
const config = require('../../config');

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
    return new Promise(async (resolve) => {
        try {
            const textHex = config.style.textColor.replace('#', '').toUpperCase();
            
            // QuickLaTeX only needs % and & escaped
            const qlEncode = (str) => str.replace(/%/g, '%25').replace(/&/g, '%26');
            
            const postData = `formula=${qlEncode(formula)}&preamble=${qlEncode(preamble)}&fsize=18px&fcolor=${textHex}&mode=0&out=1&remhost=quicklatex.com`;

            const options = {
                hostname: 'quicklatex.com',
                port: 443,
                path: '/latex3.f',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const req = https.request(options, (res) => {
                if (res.statusCode !== 200) {
                    resolve({ success: false, error: `QuickLaTeX server returned status code ${res.statusCode}` });
                    return;
                }

                let body = '';
                res.on('data', (chunk) => { body += chunk; });
                res.on('end', async () => {
                    try {
                        const parsedResponse = parseQuickLaTeXResponse(body);
                        if (!parsedResponse.success) {
                            resolve(parsedResponse);
                            return;
                        }

                        const imageUrl = parsedResponse.imageUrl;

                        // SSRF guard: only fetch from known QuickLaTeX hosts
                        let parsed;
                        try { parsed = new url.URL(imageUrl); }
                        catch (_) {
                            resolve({ success: false, error: 'QuickLaTeX returned an invalid image URL.' });
                            return;
                        }
                        if (parsed.protocol !== 'https:' || !QUICKLATEX_ALLOWED_HOSTS.has(parsed.hostname)) {
                            resolve({ success: false, error: 'QuickLaTeX returned an image URL from an unexpected host.' });
                            return;
                        }

                        https.get(imageUrl, (imgRes) => {
                            if (imgRes.statusCode !== 200) {
                                resolve({ success: false, error: `Failed to download image from QuickLaTeX: ${imgRes.statusCode}` });
                                return;
                            }

                            const chunks = [];
                            imgRes.on('data', (chunk) => chunks.push(chunk));
                            imgRes.on('end', async () => {
                                try {
                                    const imgBuf = Buffer.concat(chunks);
                                    const b64 = imgBuf.toString('base64');

                                    const katexModule = require('./katex');
                                    const isInitialized = katexModule.isInitialized();
                                    const page = renderPage || katexModule.getPage();

                                    if (!isInitialized || !page) {
                                        resolve({ success: true, data: b64, source: 'quicklatex-raw' });
                                        return;
                                    }

                                    // Embed the image in our styled card via DOM (not innerHTML, to avoid XSS)
                                    await page.evaluate((b64) => {
                                        const mathDiv = document.getElementById('math');
                                        while (mathDiv.firstChild) mathDiv.removeChild(mathDiv.firstChild);
                                        const img = document.createElement('img');
                                        img.src = `data:image/png;base64,${b64}`;
                                        img.style.display = 'block';
                                        img.style.maxWidth = '100%';
                                        img.style.height = 'auto';
                                        mathDiv.appendChild(img);
                                        return { success: true };
                                    }, b64);

                                    const card = await page.$('#card');
                                    const screenshotBuf = await card.screenshot({ type: 'png', omitBackground: true });

                                    resolve({ success: true, data: screenshotBuf.toString('base64'), source: 'quicklatex-card' });
                                } catch (err) {
                                    resolve({ success: false, error: `Error during card screenshot generation: ${err.message}` });
                                }
                            });
                        }).on('error', (err) => {
                            resolve({ success: false, error: `Failed to fetch image data: ${err.message}` });
                        });
                    } catch (err) {
                        resolve({ success: false, error: `Error parsing QuickLaTeX response: ${err.message}` });
                    }
                });
            });

            req.on('error', (err) => {
                resolve({ success: false, error: `QuickLaTeX connection error: ${err.message}` });
            });

            req.write(postData);
            req.end();
        } catch (err) {
            resolve({ success: false, error: `Failed to initiate QuickLaTeX request: ${err.message}` });
        }
    });
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
