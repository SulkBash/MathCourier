const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https');
const url = require('url');
const config = require('./config');
const { create, all } = require('mathjs');
const math = create(all);

// ─── Security constants ────────────────────────────────────────────────────────
/** Maximum allowed length (characters) for any user-supplied formula / expression. */
const MAX_INPUT_LENGTH = 4000;

/**
 * Allowed hostnames for the image URL returned by the QuickLaTeX API response.
 * This prevents SSRF attacks where a malicious QuickLaTeX response redirects us
 * to an internal network address.
 */
const QUICKLATEX_ALLOWED_HOSTS = new Set(['quicklatex.com', 'www.quicklatex.com']);

// ─── Rate limiter ─────────────────────────────────────────────────────────────
/**
 * Simple in-memory rate limiter (per sender ID).
 * Allows at most MAX_REQUESTS_PER_WINDOW renders within RATE_WINDOW_MS milliseconds.
 */
const RATE_WINDOW_MS = 60_000;   // 1 minute sliding window
const MAX_REQUESTS_PER_WINDOW = 10;
const _rateLimitMap = new Map(); // senderId -> { count, windowStart }

/**
 * Returns true if the given sender has exceeded the rate limit.
 * @param {string} senderId
 */
function isRateLimited(senderId) {
    const now = Date.now();
    let entry = _rateLimitMap.get(senderId);
    if (!entry || now - entry.windowStart >= RATE_WINDOW_MS) {
        // Start a fresh window
        entry = { count: 1, windowStart: now };
        _rateLimitMap.set(senderId, entry);
        return false;
    }
    entry.count++;
    if (entry.count > MAX_REQUESTS_PER_WINDOW) {
        return true; // Rate limited
    }
    return false;
}

/**
 * Validates that a formula string is within the allowed length limit.
 * @param {string} formula
 * @returns {string|null} Error message if invalid, or null if OK.
 */
function validateInputLength(formula) {
    if (!formula || typeof formula !== 'string') {
        return 'Empty or invalid formula.';
    }
    if (formula.length > MAX_INPUT_LENGTH) {
        return `Input too long. Maximum allowed length is ${MAX_INPUT_LENGTH} characters.`;
    }
    return null;
}
// ──────────────────────────────────────────────────────────────────────────────

// Define custom function aliases for user convenience
math.import({
    // Inverse trigonometric aliases
    arcsin: math.asin,
    arccos: math.acos,
    arctan: math.atan,
    arccot: math.acot,
    arcsec: math.asec,
    arccsc: math.acsc,
    
    // Hyperbolic inverse trigonometric aliases
    arcsinh: math.asinh,
    arccosh: math.acosh,
    arctanh: math.atanh,
    arccoth: math.acoth,
    arcsech: math.asech,
    arccsch: math.acsch,

    // Cosecant aliases
    cosec: math.csc,
    cosech: math.csch,

    // Natural logarithm alias
    ln: math.log,

    // Tangent/cotangent shorthand aliases
    tg: math.tan,
    ctg: math.cot,
    arctg: math.atan,
    arcctg: math.acot
}, { override: true });


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
    function interpolateColor(color1, color2, factor) {
      function parseColor(c) {
        if (c.startsWith('#')) {
          const hex = c.slice(1);
          if (hex.length === 3) {
            return [
              parseInt(hex[0] + hex[0], 16),
              parseInt(hex[1] + hex[1], 16),
              parseInt(hex[2] + hex[2], 16)
            ];
          }
          return [
            parseInt(hex.slice(0, 2), 16),
            parseInt(hex.slice(2, 4), 16),
            parseInt(hex.slice(4, 6), 16)
          ];
        }
        return [6, 182, 212];
      }
      const c1 = parseColor(color1);
      const c2 = parseColor(color2);
      const r = Math.round(c1[0] + factor * (c2[0] - c1[0]));
      const g = Math.round(c1[1] + factor * (c2[1] - c1[1]));
      const b = Math.round(c1[2] + factor * (c2[2] - c1[2]));
      return "rgb(" + r + ", " + g + ", " + b + ")";
    }

    function renderFormula(latex, isBlock) {
      const mathDiv = document.getElementById('math');
      try {
        katex.render(latex, mathDiv, {
          displayMode: isBlock,
          throwOnError: true,
          // trust: false (default) — do NOT enable; it allows arbitrary HTML/href injection
          trust: false
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
          // trust: false (default) — do NOT enable; it allows arbitrary HTML/href injection
          trust: false
        });
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
    function renderGraph(latex, type, data, options) {
      const mathDiv = document.getElementById('math');
      try {
        // Render equation header at the top
        katex.render(latex, mathDiv, {
          displayMode: true,
          throwOnError: true,
          // trust: false (default) — do NOT enable; it allows arbitrary HTML/href injection
          trust: false
        });

        // Ensure canvas exists and is sized correctly
        let canvas = document.getElementById('graph-canvas');
        if (!canvas) {
          canvas = document.createElement('canvas');
          canvas.id = 'graph-canvas';
          canvas.style.marginTop = '16px';
          canvas.style.display = 'block';
          canvas.style.borderRadius = '8px';
          // Insert canvas before watermark
          const watermarkDiv = document.getElementById('watermark');
          mathDiv.parentNode.insertBefore(canvas, watermarkDiv);
        }
        
        canvas.width = options.width || 600;
        canvas.height = options.height || 450;
        canvas.style.width = canvas.width + 'px';
        canvas.style.height = canvas.height + 'px';

        drawGraphOnCanvas(canvas, type, data, options);
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    function drawGraphOnCanvas(canvas, type, data, options) {
      const ctx = canvas.getContext('2d');
      const width = canvas.width;
      const height = canvas.height;
      
      // Clear canvas
      ctx.clearRect(0, 0, width, height);
      
      // Domain and range in math space
      const xMin = options.xDomain[0];
      const xMax = options.xDomain[1];
      const yMin = options.yDomain[0];
      const yMax = options.yDomain[1];
      
      // Coordinate conversion helpers: math space -> screen space
      function toScreenX(x) {
        return ((x - xMin) / (xMax - xMin)) * width;
      }
      function toScreenY(y) {
        return height - ((y - yMin) / (yMax - yMin)) * height;
      }
      
      // Grid lines
      ctx.strokeStyle = options.gridColor || 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 1;
      
      // Choose grid intervals
      function getGridStep(min, max) {
        const range = max - min;
        const roughStep = range / 8;
        const p10 = Math.pow(10, Math.floor(Math.log10(roughStep)));
        const ratio = roughStep / p10;
        if (ratio < 1.5) return p10;
        if (ratio < 3.5) return p10 * 2;
        if (ratio < 7.5) return p10 * 5;
        return p10 * 10;
      }
      
      const xStep = getGridStep(xMin, xMax);
      const yStep = getGridStep(yMin, yMax);
      
      // Vertical grid lines
      const startX = Math.ceil(xMin / xStep) * xStep;
      for (let x = startX; x <= xMax; x += xStep) {
        if (Math.abs(x) < 1e-10) continue;
        ctx.beginPath();
        ctx.moveTo(toScreenX(x), 0);
        ctx.lineTo(toScreenX(x), height);
        ctx.stroke();
      }
      
      // Horizontal grid lines
      const startY = Math.ceil(yMin / yStep) * yStep;
      for (let y = startY; y <= yMax; y += yStep) {
        if (Math.abs(y) < 1e-10) continue;
        ctx.beginPath();
        ctx.moveTo(0, toScreenY(y));
        ctx.lineTo(width, toScreenY(y));
        ctx.stroke();
      }
      
      // Axes (X and Y)
      ctx.strokeStyle = options.axisColor || 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 2;
      
      const screenX0 = toScreenX(0);
      const screenY0 = toScreenY(0);
      
      ctx.beginPath();
      ctx.moveTo(0, screenY0);
      ctx.lineTo(width, screenY0);
      ctx.stroke();
      
      ctx.beginPath();
      ctx.moveTo(screenX0, 0);
      ctx.lineTo(screenX0, height);
      ctx.stroke();
      
      // Axis ticks and labels
      ctx.fillStyle = options.axisLabelColor || 'rgba(248, 250, 252, 0.5)';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      
      // X ticks and labels
      for (let x = startX; x <= xMax; x += xStep) {
        const sx = toScreenX(x);
        ctx.beginPath();
        ctx.moveTo(sx, screenY0 - 4);
        ctx.lineTo(sx, screenY0 + 4);
        ctx.stroke();
        
        const labelY = screenY0 + 6 > height - 15 ? screenY0 - 18 : screenY0 + 6;
        const label = Number(x.toFixed(10)).toString();
        ctx.fillText(label, sx, labelY);
      }
      
      // Y ticks and labels
      ctx.textAlign = screenX0 - 6 < 15 ? 'left' : 'right';
      ctx.textBaseline = 'middle';
      for (let y = startY; y <= yMax; y += yStep) {
        if (Math.abs(y) < 1e-10) continue;
        const sy = toScreenY(y);
        ctx.beginPath();
        ctx.moveTo(screenX0 - 4, sy);
        ctx.lineTo(screenX0 + 4, sy);
        ctx.stroke();
        
        const labelX = screenX0 - 6 < 15 ? screenX0 + 8 : screenX0 - 6;
        const label = Number(y.toFixed(10)).toString();
        ctx.fillText(label, labelX, sy);
      }
      
      if (screenX0 >= 0 && screenX0 <= width && screenY0 >= 0 && screenY0 <= height) {
        ctx.fillText('0', screenX0 - 6 < 15 ? screenX0 + 8 : screenX0 - 6, screenY0 + 6);
      }
      
      // Plot curves
      ctx.save();
      ctx.lineWidth = options.lineWidth || 3.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      
      // Glow effect
      ctx.shadowColor = options.glowColor || 'rgba(6, 182, 212, 0.4)';
      ctx.shadowBlur = options.glowBlur || 10;
      
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      const colors = options.curveColors || ['#06b6d4', '#8b5cf6'];
      gradient.addColorStop(0, colors[0]);
      gradient.addColorStop(1, colors[1]);
      ctx.strokeStyle = gradient;
      
      if (type === 'explicit') {
        let isDrawing = false;
        ctx.beginPath();
        for (let i = 0; i < data.length; i++) {
          const pt = data[i];
          if (pt.y === null || isNaN(pt.y) || !isFinite(pt.y)) {
            isDrawing = false;
            continue;
          }
          
          const sx = toScreenX(pt.x);
          const sy = toScreenY(pt.y);
          const isOutOfBounds = sy < -height || sy > height * 2 || sx < -width || sx > width * 2;
          
          if (!isDrawing) {
            if (!isOutOfBounds) {
              if (i > 0 && data[i-1].y !== null && !isNaN(data[i-1].y) && isFinite(data[i-1].y)) {
                const prevPt = data[i-1];
                ctx.moveTo(toScreenX(prevPt.x), toScreenY(prevPt.y));
                ctx.lineTo(sx, sy);
              } else {
                ctx.moveTo(sx, sy);
              }
              isDrawing = true;
            }
          } else {
            ctx.lineTo(sx, sy);
            if (isOutOfBounds) {
              isDrawing = false;
            }
          }
        }
        ctx.stroke();
        
        // Fill area under the curve
        ctx.restore();
        ctx.save();
        const fillGradient = ctx.createLinearGradient(0, 0, 0, height);
        fillGradient.addColorStop(0, colors[0] + '22');
        fillGradient.addColorStop(1, 'transparent');
        ctx.fillStyle = fillGradient;
        
        let isPathStarted = false;
        for (let i = 0; i < data.length; i++) {
          const pt = data[i];
          const validVal = pt.y !== null && !isNaN(pt.y) && isFinite(pt.y);
          if (validVal) {
            if (!isPathStarted) {
              ctx.beginPath();
              ctx.moveTo(toScreenX(pt.x), toScreenY(0));
              ctx.lineTo(toScreenX(pt.x), toScreenY(pt.y));
              isPathStarted = true;
            } else {
              ctx.lineTo(toScreenX(pt.x), toScreenY(pt.y));
            }
          }
          
          if (isPathStarted && (!validVal || i === data.length - 1)) {
            const lastPt = data[validVal ? i : i - 1];
            ctx.lineTo(toScreenX(lastPt.x), toScreenY(0));
            ctx.closePath();
            ctx.fill();
            isPathStarted = false;
          }
        }
        
      } else if (type === 'implicit') {
        const X = data.X;
        const Y = data.Y;
        const V = data.V;
        const N = X.length;
        const M = Y.length;
        
        ctx.beginPath();
        for (let i = 0; i < N - 1; i++) {
          for (let j = 0; j < M - 1; j++) {
            const v00 = V[i][j];
            const v10 = V[i+1][j];
            const v11 = V[i+1][j+1];
            const v01 = V[i][j+1];
            
            if (isNaN(v00) || isNaN(v10) || isNaN(v11) || isNaN(v01) ||
                !isFinite(v00) || !isFinite(v10) || !isFinite(v11) || !isFinite(v01)) {
              continue;
            }
            
            const crossings = [];
            if (v00 * v10 <= 0 && v00 !== v10) {
              const t = -v00 / (v10 - v00);
              crossings.push({ x: X[i] + t * (X[i+1] - X[i]), y: Y[j] });
            }
            if (v10 * v11 <= 0 && v10 !== v11) {
              const t = -v10 / (v11 - v10);
              crossings.push({ x: X[i+1], y: Y[j] + t * (Y[j+1] - Y[j]) });
            }
            if (v01 * v11 <= 0 && v01 !== v11) {
              const t = -v01 / (v11 - v01);
              crossings.push({ x: X[i] + t * (X[i+1] - X[i]), y: Y[j+1] });
            }
            if (v00 * v01 <= 0 && v00 !== v01) {
              const t = -v00 / (v01 - v00);
              crossings.push({ x: X[i], y: Y[j] + t * (Y[j+1] - Y[j]) });
            }
            
            if (crossings.length === 2) {
              ctx.moveTo(toScreenX(crossings[0].x), toScreenY(crossings[0].y));
              ctx.lineTo(toScreenX(crossings[1].x), toScreenY(crossings[1].y));
            } else if (crossings.length === 4) {
              ctx.moveTo(toScreenX(crossings[0].x), toScreenY(crossings[0].y));
              ctx.lineTo(toScreenX(crossings[1].x), toScreenY(crossings[1].y));
              ctx.moveTo(toScreenX(crossings[2].x), toScreenY(crossings[2].y));
              ctx.lineTo(toScreenX(crossings[3].x), toScreenY(crossings[3].y));
            }
          }
        }
        ctx.stroke();
      } else if (type === 'vector') {
        const points = data.points;
        const scale = data.scale;
        
        ctx.save();
        ctx.lineWidth = options.lineWidth || 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        
        const colors = options.curveColors || ['#06b6d4', '#8b5cf6'];
        
        points.forEach(pt => {
          if (isNaN(pt.u) || pt.u === null || isNaN(pt.v) || pt.v === null || !isFinite(pt.u) || !isFinite(pt.v)) {
            return;
          }
          
          const magnitude = Math.sqrt(pt.u * pt.u + pt.v * pt.v);
          if (magnitude < 1e-8) return;
          
          const sx = toScreenX(pt.x);
          const sy = toScreenY(pt.y);
          
          const ex = toScreenX(pt.x + pt.u * scale);
          const ey = toScreenY(pt.y + pt.v * scale);
          
          let ratio = pt.norm;
          if (ratio > 1) ratio = 1;
          if (ratio < 0) ratio = 0;
          
          ctx.strokeStyle = interpolateColor(colors[0], colors[1], ratio);
          
          const dx = ex - sx;
          const dy = ey - sy;
          const pixelLength = Math.sqrt(dx * dx + dy * dy);
          const headLength = options.arrowHeadLength || 10;
          
          if (pixelLength > headLength) {
            const angle = Math.atan2(dy, dx);
            const shaftEndX = ex - headLength * Math.cos(angle);
            const shaftEndY = ey - headLength * Math.sin(angle);
            
            // Draw arrow shaft stopping at arrowhead base
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(shaftEndX, shaftEndY);
            ctx.stroke();
            
            // Draw arrowhead at the vector tip
            ctx.beginPath();
            ctx.moveTo(ex, ey);
            ctx.lineTo(ex - headLength * Math.cos(angle - Math.PI / 6), ey - headLength * Math.sin(angle - Math.PI / 6));
            ctx.lineTo(ex - headLength * Math.cos(angle + Math.PI / 6), ey - headLength * Math.sin(angle + Math.PI / 6));
            ctx.closePath();
            ctx.fillStyle = ctx.strokeStyle;
            ctx.fill();
          } else {
            // Draw simple line if too small for arrowhead
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(ex, ey);
            ctx.stroke();
          }
        });
        ctx.restore();
      }
      ctx.restore();
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

                        // ── SSRF guard: only fetch from known QuickLaTeX hosts ────────────
                        let parsedUrl;
                        try {
                            parsedUrl = new url.URL(imageUrl);
                        } catch (_) {
                            resolve({ success: false, error: 'QuickLaTeX returned an invalid image URL.' });
                            return;
                        }
                        if (parsedUrl.protocol !== 'https:' || !QUICKLATEX_ALLOWED_HOSTS.has(parsedUrl.hostname)) {
                            resolve({ success: false, error: 'QuickLaTeX returned an image URL from an unexpected host.' });
                            return;
                        }
                        // ─────────────────────────────────────────────────────────────────

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

                                    // Render inside our beautiful card.
                                    // Use DOM APIs instead of innerHTML to avoid XSS if the
                                    // base64 string ever contains a crafted payload.
                                    await page.evaluate((b64) => {
                                        const mathDiv = document.getElementById('math');
                                        // Clear previous content safely
                                        while (mathDiv.firstChild) mathDiv.removeChild(mathDiv.firstChild);
                                        const img = document.createElement('img');
                                        img.src = `data:image/png;base64,${b64}`;
                                        img.style.display = 'block';
                                        img.style.maxWidth = '100%';
                                        img.style.height = 'auto';
                                        mathDiv.appendChild(img);
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

/**
 * Helper to insert implicit multiplication operators between adjacent variables (x and y)
 * to ensure mathjs evaluates them correctly (e.g., "yx" -> "y*x").
 */
function preprocessExpression(expr) {
    if (!expr) return '';
    return expr
        .replace(/([xX])\s*([yY])/g, '$1*$2')
        .replace(/([yY])\s*([xX])/g, '$1*$2')
        .replace(/([xX])\s*([xX])/g, '$1*$2')
        .replace(/([yY])\s*([yY])/g, '$1*$2')
        .replace(/([xXyY])\s*\(/g, '$1*(');
}

/**
 * Renders a function or equation plot using the local Puppeteer browser.
 * @param {string} rawExpr - The raw expression to plot (e.g. "y = x^2" or "x^2 + y^2 = 1").
 * @param {object} customOptions - Overrides for domains, etc.
 * @returns {Promise<{success: boolean, data?: string, error?: string, source?: string}>}
 */
async function renderPlot(rawExpr, customOptions = {}) {
    if (!isInitialized || !page) {
        return { success: false, error: 'Local renderer is not initialized.' };
    }

    try {
        const cleanExpr = rawExpr.trim();
        
        // Setup options merging config styles and defaults
        const graphStyle = config.style.graph || {};
        const options = {
            width: graphStyle.width || 600,
            height: graphStyle.height || 450,
            gridColor: graphStyle.gridColor || 'rgba(255, 255, 255, 0.06)',
            axisColor: graphStyle.axisColor || 'rgba(255, 255, 255, 0.3)',
            axisLabelColor: graphStyle.axisLabelColor || 'rgba(248, 250, 252, 0.5)',
            curveColors: graphStyle.curveColors || ['#06b6d4', '#8b5cf6'],
            glowColor: graphStyle.glowColor || 'rgba(6, 182, 212, 0.4)',
            glowBlur: graphStyle.glowBlur || 10,
            lineWidth: graphStyle.lineWidth || 3.5,
            xDomain: customOptions.xDomain || graphStyle.defaultXDomain || [-10, 10],
            yDomain: customOptions.yDomain || graphStyle.defaultYDomain || [-10, 10],
            fontFamily: config.style.fontFamily || 'sans-serif'
        };

        // Determine if vector, explicit or implicit
        let isImplicit = false;
        let isVector = false;
        let leftExprText = '';
        let rightExprText = '';
        let funcName = '';
        let uExprText = '';
        let vExprText = '';

        // Matches patterns like v(x,y) = (...) or F(x, y) = (...)
        const outerMatch = cleanExpr.match(/^([a-zA-Z])\(x\s*,\s*y\)\s*=\s*\((.*)\)$/);
        
        let vectorSplit = null;
        if (outerMatch) {
            // Helper to split components by top-level comma (ignoring commas inside inner parentheses)
            const innerContent = outerMatch[2];
            let depth = 0;
            for (let i = 0; i < innerContent.length; i++) {
                if (innerContent[i] === '(' || innerContent[i] === '[' || innerContent[i] === '{') {
                    depth++;
                } else if (innerContent[i] === ')' || innerContent[i] === ']' || innerContent[i] === '}') {
                    depth--;
                } else if (innerContent[i] === ',' && depth === 0) {
                    vectorSplit = [innerContent.substring(0, i).trim(), innerContent.substring(i + 1).trim()];
                    break;
                }
            }
        }

        if (outerMatch && vectorSplit) {
            isVector = true;
            funcName = outerMatch[1].trim();
            uExprText = vectorSplit[0];
            vExprText = vectorSplit[1];
        } else if (cleanExpr.includes('=')) {
            const eqIndex = cleanExpr.indexOf('=');
            leftExprText = cleanExpr.substring(0, eqIndex).trim();
            rightExprText = cleanExpr.substring(eqIndex + 1).trim();
            
            // Check if LHS is just y or f(x)
            const isExplicitLhs = /^(y|f\(x\))$/i.test(leftExprText);
            if (!isExplicitLhs) {
                isImplicit = true;
            }
        } else {
            // No '=': treat as y = expression
            rightExprText = cleanExpr;
            leftExprText = 'y';
        }

        let type = '';
        let plotData = null;
        let latexText = '';

        if (isVector) {
            type = 'vector';
            let uCompiled, vCompiled;
            try {
                uCompiled = math.compile(preprocessExpression(uExprText));
                vCompiled = math.compile(preprocessExpression(vExprText));
            } catch (err) {
                return { success: false, error: `Parsing error in vector field components: ${err.message}` };
            }

            const steps = 16;
            const [xMin, xMax] = options.xDomain;
            const [yMin, yMax] = options.yDomain;
            const xStepSize = (xMax - xMin) / steps;
            const yStepSize = (yMax - yMin) / steps;

            const points = [];
            let maxMag = 0;

            const cleanValue = (val) => {
                if (val && typeof val === 'object') {
                    if (val.isComplex) {
                        return Math.abs(val.im) < 1e-10 ? val.re : NaN;
                    }
                    return val.toNumber ? val.toNumber() : NaN;
                }
                return typeof val === 'number' ? val : NaN;
            };

            for (let i = 0; i <= steps; i++) {
                const x = xMin + i * xStepSize;
                for (let j = 0; j <= steps; j++) {
                    const y = yMin + j * yStepSize;
                    try {
                        let uVal = cleanValue(uCompiled.evaluate({ x, y }));
                        let vVal = cleanValue(vCompiled.evaluate({ x, y }));
                        
                        if (!isNaN(uVal) && isFinite(uVal) && !isNaN(vVal) && isFinite(vVal)) {
                            const mag = Math.sqrt(uVal * uVal + vVal * vVal);
                            if (mag > maxMag) {
                                maxMag = mag;
                            }
                            points.push({ x, y, u: uVal, v: vVal, mag });
                        }
                    } catch (e) {
                        // Skip points with calculation errors
                    }
                }
            }

            plotData = {
                points: points.map(pt => ({
                    x: pt.x,
                    y: pt.y,
                    u: pt.u,
                    v: pt.v,
                    norm: maxMag > 0 ? pt.mag / maxMag : 0
                })),
                scale: maxMag > 0 ? (xStepSize * 0.9) / maxMag : 0
            };

            try {
                const latexFunc = `\\vec{${funcName}}(x,y)`;
                const latexU = math.parse(uExprText).toTex();
                const latexV = math.parse(vExprText).toTex();
                latexText = `${latexFunc} = \\begin{pmatrix} ${latexU} \\\\ ${latexV} \\end{pmatrix}`;
            } catch (e) {
                latexText = `\\vec{${funcName}}(x,y) = \\left( ${uExprText}, ${vExprText} \\right)`;
            }
        } else if (!isImplicit) {
            type = 'explicit';
            let compiledExpr;
            try {
                compiledExpr = math.compile(preprocessExpression(rightExprText));
            } catch (err) {
                return { success: false, error: `Parsing error in expression: ${err.message}` };
            }

            const points = [];
            const [xMin, xMax] = options.xDomain;
            const [yMin, yMax] = options.yDomain;
            const steps = 400;
            const stepSize = (xMax - xMin) / steps;

            function evaluateExpression(x) {
                try {
                    let val = compiledExpr.evaluate({ x });
                    if (val && typeof val === 'object') {
                        if (val.isComplex) {
                            val = Math.abs(val.im) < 1e-10 ? val.re : NaN;
                        } else {
                            val = val.toNumber ? val.toNumber() : NaN;
                        }
                    }
                    if (typeof val === 'number' && !isNaN(val) && isFinite(val)) {
                        return val;
                    }
                } catch (e) {
                }
                return null;
            }

            const maxDepth = 6;
            const minXDist = (xMax - xMin) / 100000;
            const yRange = yMax - yMin;
            const thresholdY = yRange * 0.01;
            const nearYDomain = (y) => y !== null && y >= yMin - yRange && y <= yMax + yRange;

            function collectPoints(x1, y1, x2, y2, depth) {
                let shouldSubdivide = false;
                let yMid = null;
                const xMid = (x1 + x2) / 2;

                if (depth < maxDepth && Math.abs(x2 - x1) >= minXDist) {
                    yMid = evaluateExpression(xMid);
                    
                    if (y1 === null && y2 === null) {
                        if (yMid !== null) shouldSubdivide = true;
                    } else if (y1 === null || y2 === null) {
                        shouldSubdivide = true;
                    } else {
                        const yDiff = Math.abs(y1 - y2);
                        if (yDiff > thresholdY && (nearYDomain(y1) || nearYDomain(y2) || nearYDomain(yMid))) {
                            shouldSubdivide = true;
                        }
                    }
                }

                if (shouldSubdivide) {
                    collectPoints(x1, y1, xMid, yMid, depth + 1);
                    collectPoints(xMid, yMid, x2, y2, depth + 1);
                } else {
                    points.push({ x: x2, y: y2 });
                }
            }

            // Start by pushing the first point
            const yStart = evaluateExpression(xMin);
            points.push({ x: xMin, y: yStart });

            for (let i = 0; i < steps; i++) {
                const x1 = xMin + i * stepSize;
                const x2 = xMin + (i + 1) * stepSize;
                const y1 = points[points.length - 1].y;
                const y2 = evaluateExpression(x2);
                collectPoints(x1, y1, x2, y2, 0);
            }

            plotData = points;

            try {
                const latexLhs = leftExprText === 'y' ? 'y' : 'f(x)';
                const latexRhs = math.parse(rightExprText).toTex();
                latexText = `${latexLhs} = ${latexRhs}`;
            } catch (e) {
                latexText = `${leftExprText} = ${rightExprText}`;
            }
        } else {
            type = 'implicit';
            const implicitExprText = `(${preprocessExpression(leftExprText)}) - (${preprocessExpression(rightExprText)})`;
            let compiledExpr;
            try {
                compiledExpr = math.compile(implicitExprText);
            } catch (err) {
                return { success: false, error: `Parsing error in equation: ${err.message}` };
            }

            const steps = 150;
            const [xMin, xMax] = options.xDomain;
            const [yMin, yMax] = options.yDomain;
            const xStepSize = (xMax - xMin) / steps;
            const yStepSize = (yMax - yMin) / steps;
            
            const X = [];
            const Y = [];
            for (let i = 0; i <= steps; i++) {
                X.push(xMin + i * xStepSize);
                Y.push(yMin + i * yStepSize);
            }

            const V = [];
            for (let i = 0; i <= steps; i++) {
                const row = [];
                const x = X[i];
                for (let j = 0; j <= steps; j++) {
                    const y = Y[j];
                    let val = NaN;
                    try {
                        let res = compiledExpr.evaluate({ x, y });
                        if (res && typeof res === 'object') {
                            if (res.isComplex) {
                                res = Math.abs(res.im) < 1e-10 ? res.re : NaN;
                            } else {
                                res = res.toNumber ? res.toNumber() : NaN;
                            }
                        }
                        if (typeof res === 'number' && !isNaN(res) && isFinite(res)) {
                            val = res;
                        }
                    } catch (e) {
                        val = NaN;
                    }
                    row.push(val);
                }
                V.push(row);
            }
            plotData = { X, Y, V };

            try {
                const latexLhs = math.parse(leftExprText).toTex();
                const latexRhs = math.parse(rightExprText).toTex();
                latexText = `${latexLhs} = ${latexRhs}`;
            } catch (e) {
                latexText = `${leftExprText} = ${rightExprText}`;
            }
        }

        const renderResult = await page.evaluate((lat, t, pData, opt) => {
            return window.renderGraph(lat, t, pData, opt);
        }, latexText, type, plotData, options);

        if (!renderResult.success) {
            return { success: false, error: renderResult.error };
        }

        const cardElement = await page.$('#card');
        if (!cardElement) {
            return { success: false, error: 'Card element not found in DOM.' };
        }

        const imageBuffer = await cardElement.screenshot({
            type: 'png',
            omitBackground: true
        });

        await page.evaluate(() => {
            const canvas = document.getElementById('graph-canvas');
            if (canvas) canvas.remove();
        });

        return {
            success: true,
            data: imageBuffer.toString('base64'),
            source: 'local-plot'
        };

    } catch (err) {
        console.error('Error during local plot rendering:', err.message);
        return { success: false, error: err.message };
    }
}

module.exports = {
    initialize,
    render,
    renderChem,
    renderTikz,
    renderPlot,
    close,
    isLocalReady: () => isInitialized,
    // Security helpers consumed by bot.js
    isRateLimited,
    validateInputLength
};
