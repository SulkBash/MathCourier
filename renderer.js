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
            console.warn('Local render failed. Attempting fallback API...');
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

module.exports = {
    initialize,
    render,
    close,
    isLocalReady: () => isInitialized
};
