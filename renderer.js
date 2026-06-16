const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https');
const config = require('./config');

let browser = null;
let page = null;
let templatePath = null;
let isInitialized = false;

/**
 * Initialize the LaTeX renderer (launches Puppeteer and prepares the template).
 */
async function initialize() {
    if (isInitialized) return;

    try {
        console.log('Initializing LaTeX Renderer...');
        
        // 1. Resolve KaTeX paths and verify installations
        const katexDir = path.join(__dirname, 'node_modules', 'katex', 'dist');
        const katexCssPath = path.join(katexDir, 'katex.min.css');
        const katexJsPath = path.join(katexDir, 'katex.min.js');
        
        if (!fs.existsSync(katexCssPath) || !fs.existsSync(katexJsPath)) {
            throw new Error('KaTeX node_modules files not found. Run npm install first.');
        }

        // 2. Generate and write the HTML rendering template inside KaTeX dist
        // This placement allows the HTML to naturally resolve KaTeX relative font assets (fonts/*)
        templatePath = path.join(katexDir, 'render_temp.html');
        
        const templateHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="katex.min.css">
  <script src="katex.min.js"></script>
  <script src="contrib/mhchem.min.js"></script>
  <script src="contrib/auto-render.min.js"></script>
  <style>
    body {
      margin: 0;
      padding: 0;
      background: transparent;
      display: inline-block;
    }
    #card {
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      background-color: ${config.style.backgroundColor};
      color: ${config.style.textColor};
      font-family: ${config.style.fontFamily};
      font-size: ${config.style.fontSize};
      padding: ${config.style.padding};
      border-radius: ${config.style.borderRadius};
      border: ${config.style.border};
      box-shadow: ${config.style.boxShadow};
      margin: 10px; /* spacing for box-shadow glow */
    }
    #math {
      display: block;
      margin-bottom: ${config.style.watermark.text ? '12px' : '0'};
    }
    #watermark {
      align-self: flex-end;
      color: ${config.style.watermark.color};
      font-size: ${config.style.watermark.fontSize};
      font-family: ${config.style.watermark.fontFamily};
    }
  </style>
</head>
<body>
  <div id="card">
    <div id="math"></div>
    <div id="watermark">${config.style.watermark.text || ''}</div>
  </div>
  <script>
    function renderFormula(latex, isBlock) {
      const mathDiv = document.getElementById('math');
      try {
        katex.render(latex, mathDiv, {
          displayMode: isBlock,
          throwOnError: true,
          trust: true
        });
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
    function renderMixedText(text) {
      const mathDiv = document.getElementById('math');
      try {
        mathDiv.textContent = text;
        renderMathInElement(mathDiv, {
          delimiters: [
            {left: "$$", right: "$$", display: true}
          ],
          throwOnError: false,
          trust: true
        });
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  </script>
</body>
</html>
`;
        fs.writeFileSync(templatePath, templateHtml, 'utf8');

        // 3. Launch Puppeteer browser
        browser = await puppeteer.launch(config.puppeteer.launchArgs);
        page = await browser.newPage();
        
        // Load the template HTML page
        const fileUrl = 'file:///' + templatePath.replace(/\\/g, '/');
        await page.goto(fileUrl);
        
        isInitialized = true;
        console.log('LaTeX Renderer initialized successfully.');
    } catch (err) {
        console.error('Failed to initialize local Puppeteer renderer:', err.message);
        console.log('Renderer will operate in Fallback API Mode.');
        isInitialized = false;
        
        // Clean up if browser was partially launched
        if (browser) {
            try { await browser.close(); } catch (e) {}
            browser = null;
            page = null;
        }
    }
}

/**
 * Render a LaTeX formula using the local Puppeteer browser.
 * @param {string} formula - The LaTeX formula to render.
 * @param {boolean} isBlock - Render in display/block mode if true, otherwise inline mode.
 * @returns {Promise<{success: boolean, data?: string, error?: string, source?: string}>}
 */
async function renderLocal(formula, isBlock = true) {
    if (!isInitialized || !page) {
        throw new Error('Local renderer is not initialized.');
    }

    try {
        // Run the rendering script inside the browser context
        let renderResult;
        if (isBlock === false) {
            renderResult = await page.evaluate((txt) => {
                return window.renderMixedText(txt);
            }, formula);
        } else {
            renderResult = await page.evaluate((f, block) => {
                return window.renderFormula(f, block);
            }, formula, isBlock);
        }

        if (!renderResult.success) {
            return { success: false, error: renderResult.error };
        }

        // Locate the card element
        const cardElement = await page.$('#card');
        if (!cardElement) {
            return { success: false, error: 'Card element not found in DOM.' };
        }

        // Take a screenshot of the card bounding box with transparent background around the card
        const imageBuffer = await cardElement.screenshot({
            type: 'png',
            omitBackground: true
        });

        return {
            success: true,
            data: imageBuffer.toString('base64'),
            source: 'local'
        };
    } catch (err) {
        console.error('Error during local render execution:', err.message);
        throw err; // Trigger the fallback if error is thrown
    }
}

/**
 * Render a LaTeX formula using the external web API fallback (Codecogs).
 * @param {string} formula - The LaTeX formula to render.
 * @returns {Promise<{success: boolean, data?: string, error?: string, source?: string}>}
 */
async function renderFallback(formula) {
    return new Promise((resolve) => {
        try {
            // Hex color values extracted from configuration (stripping the leading #)
            const bgHex = config.style.backgroundColor.replace('#', '');
            const textHex = config.style.textColor.replace('#', '');
            
            // Encode the LaTeX formula
            const escapedFormula = encodeURIComponent(formula);
            
            // Build Codecogs API URL with matched configuration colors and 200 DPI resolution
            const url = `https://latex.codecogs.com/png.image?\\dpi{200}\\bg{${bgHex}}\\color{${textHex}}${escapedFormula}`;
            
            https.get(url, (res) => {
                if (res.statusCode !== 200) {
                    resolve({
                        success: false,
                        error: `Web API returned status code ${res.statusCode}`
                    });
                    return;
                }

                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const buffer = Buffer.concat(chunks);
                    resolve({
                        success: true,
                        data: buffer.toString('base64'),
                        source: 'fallback-api'
                    });
                });
            }).on('error', (err) => {
                resolve({
                    success: false,
                    error: `Network error on Web API request: ${err.message}`
                });
            });
        } catch (err) {
            resolve({
                success: false,
                error: `Web API preparation failed: ${err.message}`
            });
        }
    });
}

/**
 * Main render function. Tries local rendering first, then falls back to Web API if enabled.
 * @param {string} formula - The LaTeX formula to render.
 * @param {boolean} isBlock - Whether to render in block format.
 * @returns {Promise<{success: boolean, data?: string, error?: string, source?: string}>}
 */
async function render(formula, isBlock = true) {
    // 1. Try local renderer if initialized
    if (isInitialized) {
        try {
            const result = await renderLocal(formula, isBlock);
            return result;
        } catch (err) {
            console.warn('Local render failed. Error:', err.message, '\nAttempting fallback API...');
        }
    }

    // 2. Try Fallback API if allowed
    if (config.bot.useFallback) {
        return await renderFallback(formula);
    }

    return {
        success: false,
        error: 'Local renderer not ready, and Web API Fallback is disabled.'
    };
}

/**
 * Close the Puppeteer browser instance.
 */
async function close() {
    if (browser) {
        await browser.close();
        browser = null;
        page = null;
        isInitialized = false;
        
        // Try to delete the temporary template file
        if (templatePath && fs.existsSync(templatePath)) {
            try { fs.unlinkSync(templatePath); } catch (e) {}
        }
        console.log('LaTeX Renderer shut down.');
    }
}

/**
 * Shared helper to render any formula via QuickLaTeX and local Puppeteer card styling.
 * @param {string} formula - The LaTeX formula/diagram.
 * @param {string} preamble - The LaTeX preamble (package imports/settings).
 * @returns {Promise<{success: boolean, data?: string, error?: string, source?: string}>}
 */
async function renderQuickLaTeX(formula, preamble) {
    return new Promise(async (resolve) => {
        try {
            // Extract text/line color from config (removing #) and ensure uppercase for xcolor HTML model
            const textHex = config.style.textColor.replace('#', '').toUpperCase();
            
            // Helper function to encode parameters for QuickLaTeX API (only escapes % and &)
            const quicklatexEncode = (str) => str.replace(/%/g, '%25').replace(/&/g, '%26');
            
            const encodedFormula = quicklatexEncode(formula);
            const encodedPreamble = quicklatexEncode(preamble);
            
            // Build raw POST body
            const postData = `formula=${encodedFormula}&preamble=${encodedPreamble}&fsize=18px&fcolor=${textHex}&mode=0&out=1&remhost=quicklatex.com`;

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

            // Post request to QuickLaTeX
            const req = https.request(options, (res) => {
                if (res.statusCode !== 200) {
                    resolve({ success: false, error: `QuickLaTeX server returned status code ${res.statusCode}` });
                    return;
                }

                let responseBody = '';
                res.on('data', (chunk) => { responseBody += chunk; });
                res.on('end', async () => {
                    try {
                        const lines = responseBody.split('\n').map(l => l.trim());
                        if (lines[0] !== '0') {
                            resolve({ success: false, error: `QuickLaTeX error: ${lines.slice(1).join(' ')}` });
                            return;
                        }

                        // Extract image URL (first token on second line)
                        const imageUrl = lines[1].split(' ')[0];
                        
                        // Download the transparent PNG image from QuickLaTeX
                        https.get(imageUrl, (imgRes) => {
                            if (imgRes.statusCode !== 200) {
                                resolve({ success: false, error: `Failed to download image from QuickLaTeX: ${imgRes.statusCode}` });
                                return;
                            }

                            const chunks = [];
                            imgRes.on('data', (chunk) => chunks.push(chunk));
                            imgRes.on('end', async () => {
                                try {
                                    const imgBuffer = Buffer.concat(chunks);
                                    const base64Img = imgBuffer.toString('base64');

                                    // If local puppeteer is not initialized, we return the raw transparent PNG directly
                                    if (!isInitialized || !page) {
                                        resolve({
                                            success: true,
                                            data: base64Img,
                                            source: 'quicklatex-raw'
                                        });
                                        return;
                                    }

                                    // Render inside our beautiful card
                                    await page.evaluate((b64) => {
                                        const mathDiv = document.getElementById('math');
                                        mathDiv.innerHTML = `<img src="data:image/png;base64,${b64}" style="display: block; max-width: 100%; height: auto;" />`;
                                        return { success: true };
                                    }, base64Img);

                                    // Capture the card screenshot
                                    const cardElement = await page.$('#card');
                                    const imageBuffer = await cardElement.screenshot({
                                        type: 'png',
                                        omitBackground: true
                                    });

                                    resolve({
                                        success: true,
                                        data: imageBuffer.toString('base64'),
                                        source: 'quicklatex-card'
                                    });
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

/**
 * Render a chemical formula using chemfig via QuickLaTeX and local Puppeteer card styling.
 * @param {string} formula - The chemfig formula (e.g., \chemfig{A-B}).
 * @returns {Promise<{success: boolean, data?: string, error?: string, source?: string}>}
 */
async function renderChem(formula) {
    const textHex = config.style.textColor.replace('#', '').toUpperCase();
    const preamble = [
        '\\usepackage{xcolor}',
        `\\definecolor{fgcolor}{HTML}{${textHex}}`,
        '\\usepackage{chemfig}',
        '\\setchemfig{bond style={color=fgcolor}}',
        '\\renewcommand*\\printatom[1]{\\color{fgcolor}\\ensuremath{\\mathrm{#1}}}'
    ].join('\n');
    return renderQuickLaTeX(formula, preamble);
}

/**
 * Render a TikZ drawing via QuickLaTeX and local Puppeteer card styling.
 * @param {string} formula - The TikZ drawing code.
 * @returns {Promise<{success: boolean, data?: string, error?: string, source?: string}>}
 */
async function renderTikz(formula) {
    const textHex = config.style.textColor.replace('#', '').toUpperCase();
    const preamble = [
        '\\usepackage{xcolor}',
        `\\definecolor{fgcolor}{HTML}{${textHex}}`,
        '\\usepackage{tikz}',
        '\\usetikzlibrary{shapes,arrows,positioning,calc,fit,backgrounds}',
        '\\tikzset{every picture/.style={color=fgcolor}}',
        '\\tikzset{every node/.style={text=fgcolor}}'
    ].join('\n');

    let fullFormula = formula.trim();
    if (!fullFormula.includes('\\begin{tikzpicture}')) {
        fullFormula = `\\begin{tikzpicture}\n${fullFormula}\n\\end{tikzpicture}`;
    }

    return renderQuickLaTeX(fullFormula, preamble);
}

module.exports = {
    initialize,
    render,
    renderChem,
    renderTikz,
    close,
    isLocalReady: () => isInitialized
};
