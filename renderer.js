const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https');
const url = require('url');
const config = require('./config');
const { create, all } = require('mathjs');
const math = create(all);

const MAX_INPUT_LENGTH = 4000;
const QUICKLATEX_ALLOWED_HOSTS = new Set(['quicklatex.com', 'www.quicklatex.com']);

// Rate limiter (per sender, sliding window)
const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;
const _rateLimitMap = new Map();

function isRateLimited(senderId) {
    const now = Date.now();
    let entry = _rateLimitMap.get(senderId);
    if (!entry || now - entry.windowStart >= RATE_WINDOW_MS) {
        entry = { count: 1, windowStart: now };
        _rateLimitMap.set(senderId, entry);
        return false;
    }
    entry.count++;
    return entry.count > MAX_REQUESTS_PER_WINDOW;
}

function validateInputLength(formula) {
    if (!formula || typeof formula !== 'string') return 'Empty or invalid formula.';
    if (formula.length > MAX_INPUT_LENGTH) {
        return `Input too long. Maximum allowed length is ${MAX_INPUT_LENGTH} characters.`;
    }
    return null;
}

function digamma(x) {
    if (x <= 0) {
        if (Math.sin(Math.PI * x) === 0) return NaN;
        return digamma(1 - x) - Math.PI / Math.tan(Math.PI * x);
    }
    let shift = 0;
    while (x < 8.0) {
        shift -= 1.0 / x;
        x += 1.0;
    }
    const r = 1.0 / x;
    const r2 = r * r;
    let val = Math.log(x) - 0.5 * r;
    val -= r2 * (1.0 / 12.0 - r2 * (1.0 / 120.0 - r2 * (1.0 / 252.0 - r2 * (1.0 / 240.0))));
    return val + shift;
}

function polygamma(n, x) {
    if (typeof n !== 'number' || typeof x !== 'number') {
        n = Number(n);
        x = Number(x);
    }
    if (isNaN(n) || isNaN(x)) return NaN;
    if (n < 0 || !Number.isInteger(n)) return NaN;
    if (n === 0) return digamma(x);
    
    let shift = 0;
    let tempX = x;
    const sign = (n % 2 === 0) ? -1 : 1;
    let fact = 1;
    for (let i = 2; i <= n; i++) fact *= i;
    
    while (tempX < 8.0) {
        if (tempX === 0) return NaN;
        shift += sign * fact / Math.pow(tempX, n + 1);
        tempX += 1.0;
    }
    
    const r = 1.0 / tempX;
    let leadFact = 1;
    for (let i = 2; i <= n - 1; i++) leadFact *= i;
    const leadSign = (n % 2 === 0) ? -1 : 1;
    let val = leadSign * leadFact * Math.pow(r, n);
    
    val += leadSign * fact * 0.5 * Math.pow(r, n + 1);
    
    let term1 = fact * (n + 1) / (12.0 * Math.pow(tempX, n + 2));
    let term2 = fact * (n + 1) * (n + 2) * (n + 3) / (720.0 * Math.pow(tempX, n + 4));
    let term3 = fact * (n + 1) * (n + 2) * (n + 3) * (n + 4) * (n + 5) / (30240.0 * Math.pow(tempX, n + 6));
    
    val += leadSign * (term1 - term2 + term3);
    return val + shift;
}
polygamma.toTex = function (node, options) {
    const nTex = node.args[0].toTex(options);
    const xTex = node.args[1].toTex(options);
    return `\\psi^{(${nTex})}\\left(${xTex}\\right)`;
};

const deriv = function(expr, varName, val) {
    return math.derivative(expr, varName).evaluate({ [varName]: val });
};
deriv.toTex = function(node, options) {
    const exprStr = node.args[0].value;
    const varStr = node.args[1].value;
    const innerTex = math.parse(exprStr).toTex();
    return `\\frac{d}{d${varStr}}\\left(${innerTex}\\right)`;
};

const integ = function(expr, varName, lower, upper) {
    const compiled = math.compile(expr);
    const f = (val) => compiled.evaluate({ [varName]: val });
    const n = 100;
    const h = (upper - lower) / n;
    let sum = 0.5 * (f(lower) + f(upper));
    for (let i = 1; i < n; i++) {
        sum += f(lower + i * h);
    }
    return sum * h;
};
integ.toTex = function(node, options) {
    const exprStr = node.args[0].value;
    const varStr = node.args[1].value;
    const lowerTex = node.args[2].toTex(options);
    const upperTex = node.args[3].toTex(options);
    const innerTex = math.parse(exprStr).toTex();
    return `\\int_{${lowerTex}}^{${upperTex}} ${innerTex} d${varStr}`;
};

const originalFactorial = math.factorial;
const factorial = function (x) {
    if (typeof x === 'number') {
        if (x < 0) return math.gamma(x + 1);
        return originalFactorial(x);
    }
    if (x && x.isBigNumber) {
        if (x.isNegative()) return math.gamma(x.toNumber() + 1);
        return originalFactorial(x);
    }
    if (x && x.isFraction) {
        const val = x.valueOf();
        if (val < 0) return math.gamma(val + 1);
        return originalFactorial(x);
    }
    if (x && x.isComplex) {
        return math.gamma(math.add(x, 1));
    }
    return originalFactorial(x);
};

math.import({
    arcsin: math.asin,
    arccos: math.acos,
    arctan: math.atan,
    arccot: math.acot,
    arcsec: math.asec,
    arccsc: math.acsc,
    arcsinh: math.asinh,
    arccosh: math.acosh,
    arctanh: math.atanh,
    arccoth: math.acoth,
    arcsech: math.asech,
    arccsch: math.acsch,
    cosec: math.csc,
    cosech: math.csch,
    ln: math.log,
    tg: math.tan,
    ctg: math.cot,
    arctg: math.atan,
    arcctg: math.acot,
    deriv,
    integ,
    factorial,
    polygamma
}, { override: true });


let browser = null;
let page = null;
let templatePath = null;
let isInitialized = false;

/**
 * Launches Puppeteer and writes the KaTeX HTML template.
 * Must be called before any rendering.
 */
async function initialize() {
    if (isInitialized) return;

    try {
        console.log('Initializing LaTeX Renderer...');
        
        const katexDir = path.join(__dirname, 'node_modules', 'katex', 'dist');
        const katexCssPath = path.join(katexDir, 'katex.min.css');
        const katexJsPath = path.join(katexDir, 'katex.min.js');
        
        if (!fs.existsSync(katexCssPath) || !fs.existsSync(katexJsPath)) {
            throw new Error('KaTeX node_modules files not found. Run npm install first.');
        }

        // Write the template inside katex/dist so relative font paths resolve naturally
        templatePath = path.join(katexDir, 'render_temp.html');
        
        const templateHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="katex.min.css">
  <script src="katex.min.js"><\/script>
  <script src="contrib/mhchem.min.js"><\/script>
  <script src="contrib/auto-render.min.js"><\/script>
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
      margin: 10px;
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
        katex.render(latex, mathDiv, {
          displayMode: true,
          throwOnError: true,
          trust: false
        });

        let canvas = document.getElementById('graph-canvas');
        if (!canvas) {
          canvas = document.createElement('canvas');
          canvas.id = 'graph-canvas';
          canvas.style.marginTop = '16px';
          canvas.style.display = 'block';
          canvas.style.borderRadius = '8px';
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
      
      ctx.clearRect(0, 0, width, height);
      
      const xMin = options.xDomain[0];
      const xMax = options.xDomain[1];
      const yMin = options.yDomain[0];
      const yMax = options.yDomain[1];
      
      function toScreenX(x) {
        return ((x - xMin) / (xMax - xMin)) * width;
      }
      function toScreenY(y) {
        return height - ((y - yMin) / (yMax - yMin)) * height;
      }
      
      // Grid
      ctx.strokeStyle = options.gridColor || 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 1;
      
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
      
      const startX = Math.ceil(xMin / xStep) * xStep;
      for (let x = startX; x <= xMax; x += xStep) {
        if (Math.abs(x) < 1e-10) continue;
        ctx.beginPath();
        ctx.moveTo(toScreenX(x), 0);
        ctx.lineTo(toScreenX(x), height);
        ctx.stroke();
      }
      
      const startY = Math.ceil(yMin / yStep) * yStep;
      for (let y = startY; y <= yMax; y += yStep) {
        if (Math.abs(y) < 1e-10) continue;
        ctx.beginPath();
        ctx.moveTo(0, toScreenY(y));
        ctx.lineTo(width, toScreenY(y));
        ctx.stroke();
      }
      
      // Axes
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
      
      // Tick labels
      ctx.fillStyle = options.axisLabelColor || 'rgba(248, 250, 252, 0.5)';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      
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
      
      // Curve
      ctx.save();
      ctx.lineWidth = options.lineWidth || 3.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      
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
          const oob = sy < -height || sy > height * 2 || sx < -width || sx > width * 2;
          
          if (!isDrawing) {
            if (!oob) {
              if (i > 0 && data[i-1].y !== null && !isNaN(data[i-1].y) && isFinite(data[i-1].y)) {
                const prev = data[i-1];
                ctx.moveTo(toScreenX(prev.x), toScreenY(prev.y));
                ctx.lineTo(sx, sy);
              } else {
                ctx.moveTo(sx, sy);
              }
              isDrawing = true;
            }
          } else {
            ctx.lineTo(sx, sy);
            if (oob) isDrawing = false;
          }
        }
        ctx.stroke();
        
        // Fill under curve
        ctx.restore();
        ctx.save();
        const fillGradient = ctx.createLinearGradient(0, 0, 0, height);
        fillGradient.addColorStop(0, colors[0] + '22');
        fillGradient.addColorStop(1, 'transparent');
        ctx.fillStyle = fillGradient;
        
        let pathStarted = false;
        for (let i = 0; i < data.length; i++) {
          const pt = data[i];
          const ok = pt.y !== null && !isNaN(pt.y) && isFinite(pt.y);
          if (ok) {
            if (!pathStarted) {
              ctx.beginPath();
              ctx.moveTo(toScreenX(pt.x), toScreenY(0));
              ctx.lineTo(toScreenX(pt.x), toScreenY(pt.y));
              pathStarted = true;
            } else {
              ctx.lineTo(toScreenX(pt.x), toScreenY(pt.y));
            }
          }
          
          if (pathStarted && (!ok || i === data.length - 1)) {
            const last = data[ok ? i : i - 1];
            ctx.lineTo(toScreenX(last.x), toScreenY(0));
            ctx.closePath();
            ctx.fill();
            pathStarted = false;
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
            
            // marching squares: find zero-crossings on cell edges
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
          const pixelLen = Math.sqrt(dx * dx + dy * dy);
          const headLen = options.arrowHeadLength || 10;
          
          if (pixelLen > headLen) {
            const angle = Math.atan2(dy, dx);
            const shaftEndX = ex - headLen * Math.cos(angle);
            const shaftEndY = ey - headLen * Math.sin(angle);
            
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(shaftEndX, shaftEndY);
            ctx.stroke();
            
            ctx.beginPath();
            ctx.moveTo(ex, ey);
            ctx.lineTo(ex - headLen * Math.cos(angle - Math.PI / 6), ey - headLen * Math.sin(angle - Math.PI / 6));
            ctx.lineTo(ex - headLen * Math.cos(angle + Math.PI / 6), ey - headLen * Math.sin(angle + Math.PI / 6));
            ctx.closePath();
            ctx.fillStyle = ctx.strokeStyle;
            ctx.fill();
          } else {
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(ex, ey);
            ctx.stroke();
          }
        });
        ctx.restore();
      } else if (type === 'ode_curves') {
        const curveKeys = Object.keys(data);
        const curveColors = options.curveColors || ['#06b6d4', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#84cc16'];
        
        curveKeys.forEach((key, idx) => {
          const points = data[key];
          const color = curveColors[idx % curveColors.length];
          
          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth = options.lineWidth || 3.5;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          
          ctx.shadowColor = color + '66';
          ctx.shadowBlur = options.glowBlur || 10;
          
          let isDrawing = false;
          ctx.beginPath();
          for (let i = 0; i < points.length; i++) {
            const pt = points[i];
            if (pt.y === null || isNaN(pt.y) || !isFinite(pt.y)) {
              isDrawing = false;
              continue;
            }
            
            const sx = toScreenX(pt.x);
            const sy = toScreenY(pt.y);
            const oob = sy < -height || sy > height * 2 || sx < -width || sx > width * 2;
            
            if (!isDrawing) {
              if (!oob) {
                if (i > 0 && points[i-1].y !== null && !isNaN(points[i-1].y) && isFinite(points[i-1].y)) {
                  const prev = points[i-1];
                  ctx.moveTo(toScreenX(prev.x), toScreenY(prev.y));
                  ctx.lineTo(sx, sy);
                } else {
                  ctx.moveTo(sx, sy);
                }
                isDrawing = true;
              }
            } else {
              ctx.lineTo(sx, sy);
              if (oob) isDrawing = false;
            }
          }
          ctx.stroke();
          ctx.restore();
        });
        
        // Draw Legend
        if (curveKeys.length > 1) {
          ctx.save();
          ctx.font = '14px sans-serif';
          ctx.textBaseline = 'middle';
          let legendX = width - 90;
          let legendY = 25;
          
          curveKeys.forEach((key, idx) => {
            const color = curveColors[idx % curveColors.length];
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(legendX, legendY, 5, 0, 2 * Math.PI);
            ctx.fill();
            
            ctx.fillStyle = options.axisLabelColor || 'rgba(248, 250, 252, 0.7)';
            ctx.fillText(key, legendX + 10, legendY);
            legendY += 20;
          });
          ctx.restore();
        }
      } else if (type === 'multi') {
        const curveColors = options.curveColors || ['#06b6d4', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#84cc16'];
        
        data.forEach((plot, idx) => {
          const color = curveColors[idx % curveColors.length];
          ctx.save();
          
          if (plot.type === 'explicit') {
            ctx.strokeStyle = color;
            ctx.lineWidth = options.lineWidth || 3.5;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            
            ctx.shadowColor = color + '66';
            ctx.shadowBlur = options.glowBlur || 10;
            
            let isDrawing = false;
            ctx.beginPath();
            const points = plot.data;
            for (let i = 0; i < points.length; i++) {
              const pt = points[i];
              if (pt.y === null || isNaN(pt.y) || !isFinite(pt.y)) {
                isDrawing = false;
                continue;
              }
              
              const sx = toScreenX(pt.x);
              const sy = toScreenY(pt.y);
              const oob = sy < -height || sy > height * 2 || sx < -width || sx > width * 2;
              
              if (!isDrawing) {
                if (!oob) {
                  if (i > 0 && points[i-1].y !== null && !isNaN(points[i-1].y) && isFinite(points[i-1].y)) {
                    const prev = points[i-1];
                    ctx.moveTo(toScreenX(prev.x), toScreenY(prev.y));
                    ctx.lineTo(sx, sy);
                  } else {
                    ctx.moveTo(sx, sy);
                  }
                  isDrawing = true;
                }
              } else {
                ctx.lineTo(sx, sy);
                if (oob) isDrawing = false;
              }
            }
            ctx.stroke();
          } else if (plot.type === 'implicit') {
            const X = plot.data.X;
            const Y = plot.data.Y;
            const V = plot.data.V;
            const N = X.length;
            const M = Y.length;
            
            ctx.strokeStyle = color;
            ctx.lineWidth = options.lineWidth || 3.5;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            
            ctx.shadowColor = color + '66';
            ctx.shadowBlur = options.glowBlur || 10;
            
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
          } else if (plot.type === 'vector') {
            const points = plot.data.points;
            const scale = plot.data.scale;
            
            ctx.lineWidth = options.lineWidth || 2;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            
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
              
              ctx.strokeStyle = color;
              
              const dx = ex - sx;
              const dy = ey - sy;
              const pixelLen = Math.sqrt(dx * dx + dy * dy);
              const headLen = options.arrowHeadLength || 10;
              
              if (pixelLen > headLen) {
                const angle = Math.atan2(dy, dx);
                const shaftEndX = ex - headLen * Math.cos(angle);
                const shaftEndY = ey - headLen * Math.sin(angle);
                
                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.lineTo(shaftEndX, shaftEndY);
                ctx.stroke();
                
                ctx.beginPath();
                ctx.moveTo(ex, ey);
                ctx.lineTo(ex - headLen * Math.cos(angle - Math.PI / 6), ey - headLen * Math.sin(angle - Math.PI / 6));
                ctx.lineTo(ex - headLen * Math.cos(angle + Math.PI / 6), ey - headLen * Math.sin(angle + Math.PI / 6));
                ctx.closePath();
                ctx.fillStyle = ctx.strokeStyle;
                ctx.fill();
              } else {
                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.lineTo(ex, ey);
                ctx.stroke();
              }
            });
          }
          ctx.restore();
        });
        
        // Draw Legend
        if (data.length > 1) {
          ctx.save();
          ctx.font = '14px sans-serif';
          ctx.textBaseline = 'middle';
          let legendX = width - 150;
          let legendY = 25;
          
          data.forEach((plot, idx) => {
            const color = curveColors[idx % curveColors.length];
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(legendX, legendY, 5, 0, 2 * Math.PI);
            ctx.fill();
            
            ctx.fillStyle = options.axisLabelColor || 'rgba(248, 250, 252, 0.7)';
            let label = plot.label || '';
            if (label.length > 18) label = label.slice(0, 16) + '...';
            ctx.fillText(label, legendX + 10, legendY);
            legendY += 20;
          });
          ctx.restore();
        }
      }
      ctx.restore();
    }
  </script>
</body>
</html>
`;
        fs.writeFileSync(templatePath, templateHtml, 'utf8');

        browser = await puppeteer.launch(config.puppeteer.launchArgs);
        page = await browser.newPage();
        
        const fileUrl = 'file:///' + templatePath.replace(/\\/g, '/');
        await page.goto(fileUrl);
        
        isInitialized = true;
        console.log('LaTeX Renderer initialized successfully.');
    } catch (err) {
        console.error('Failed to initialize local Puppeteer renderer:', err.message);
        console.log('Renderer will operate in Fallback API Mode.');
        isInitialized = false;
        
        if (browser) {
            try { await browser.close(); } catch (e) {}
            browser = null;
            page = null;
        }
    }
}

// Coerce mathjs result to a plain number, returning NaN for complex/invalid values
function toReal(val) {
    if (val && typeof val === 'object') {
        if (val.entries && Array.isArray(val.entries)) {
            val = val.entries[val.entries.length - 1];
        }
    }
    if (val && typeof val === 'object') {
        if (val.isComplex) return Math.abs(val.im) < 1e-10 ? val.re : NaN;
        return val.toNumber ? val.toNumber() : NaN;
    }
    return typeof val === 'number' ? val : NaN;
}

async function renderLocal(formula, isBlock = true) {
    if (!isInitialized || !page) {
        throw new Error('Local renderer is not initialized.');
    }

    try {
        let result;
        if (isBlock === false) {
            result = await page.evaluate((txt) => window.renderMixedText(txt), formula);
        } else {
            result = await page.evaluate((f, block) => window.renderFormula(f, block), formula, isBlock);
        }

        if (!result.success) return { success: false, error: result.error };

        const card = await page.$('#card');
        if (!card) return { success: false, error: 'Card element not found in DOM.' };

        const buf = await card.screenshot({ type: 'png', omitBackground: true });

        return { success: true, data: buf.toString('base64'), source: 'local' };
    } catch (err) {
        console.error('Error during local render:', err.message);
        throw err;
    }
}

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

/**
 * Main render entry point. Tries local Puppeteer first, then the Codecogs API.
 */
async function render(formula, isBlock = true) {
    if (isInitialized) {
        try {
            return await renderLocal(formula, isBlock);
        } catch (err) {
            console.warn('Local render failed:', err.message, '— trying fallback...');
        }
    }

    if (config.bot.useFallback) return await renderFallback(formula);

    return { success: false, error: 'Local renderer not ready, and Web API Fallback is disabled.' };
}

async function close() {
    if (browser) {
        await browser.close();
        browser = null;
        page = null;
        isInitialized = false;
        
        if (templatePath && fs.existsSync(templatePath)) {
            try { fs.unlinkSync(templatePath); } catch (e) {}
        }
        console.log('LaTeX Renderer shut down.');
    }
}

// Shared helper for QuickLaTeX POST requests (used by renderChem and renderTikz)
async function renderQuickLaTeX(formula, preamble) {
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
                        const lines = body.split('\n').map(l => l.trim());
                        if (lines[0] !== '0') {
                            resolve({ success: false, error: `QuickLaTeX error: ${lines.slice(1).join(' ')}` });
                            return;
                        }

                        const imageUrl = lines[1].split(' ')[0];

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

function renderChem(formula) {
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

function renderTikz(formula) {
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

    return renderQuickLaTeX(full, preamble);
}

// Insert implicit multiplication between adjacent x/y variables for mathjs
function preprocessExpr(expr) {
    if (!expr) return '';
    return expr
        .replace(/([xX])\s*([yY])/g, '$1*$2')
        .replace(/([yY])\s*([xX])/g, '$1*$2')
        .replace(/([xX])\s*([xX])/g, '$1*$2')
        .replace(/([yY])\s*([yY])/g, '$1*$2')
        .replace(/([xXyY])\s*\(/g, '$1*(');
}

function splitByTopLevelCommas(expr) {
    const parts = [];
    let current = '';
    let parenDepth = 0;
    let inQuotes = false;
    let quoteChar = null;

    for (let i = 0; i < expr.length; i++) {
        const char = expr[i];
        if (inQuotes) {
            if (char === '\\') {
                current += char;
                if (i + 1 < expr.length) {
                    current += expr[i + 1];
                    i++;
                }
            } else if (char === quoteChar) {
                inQuotes = false;
                current += char;
            } else {
                current += char;
            }
        } else {
            if (char === '"' || char === "'") {
                inQuotes = true;
                quoteChar = char;
                current += char;
            } else if (char === '(' || char === '[' || char === '{') {
                parenDepth++;
                current += char;
            } else if (char === ')' || char === ']' || char === '}') {
                parenDepth = Math.max(0, parenDepth - 1);
                current += char;
            } else if (char === ',' && parenDepth === 0) {
                parts.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
    }
    if (current.trim()) {
        parts.push(current.trim());
    }
    return parts;
}

function splitByTopLevelSemicolons(expr) {
    const parts = [];
    let current = '';
    let parenDepth = 0;
    let inQuotes = false;
    let quoteChar = null;

    for (let i = 0; i < expr.length; i++) {
        const char = expr[i];
        if (inQuotes) {
            if (char === '\\') {
                current += char;
                if (i + 1 < expr.length) {
                    current += expr[i + 1];
                    i++;
                }
            } else if (char === quoteChar) {
                inQuotes = false;
                current += char;
            } else {
                current += char;
            }
        } else {
            if (char === '"' || char === "'") {
                inQuotes = true;
                quoteChar = char;
                current += char;
            } else if (char === '(' || char === '[' || char === '{') {
                parenDepth++;
                current += char;
            } else if (char === ')' || char === ']' || char === '}') {
                parenDepth = Math.max(0, parenDepth - 1);
                current += char;
            } else if (char === ';' && parenDepth === 0) {
                parts.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
    }
    if (current.trim()) {
        parts.push(current.trim());
    }
    return parts;
}

function parseSingleExpression(expr, opts) {
    let isImplicit = false;
    let isVector = false;
    let lhs = '';
    let rhs = '';
    let funcName = '';
    let uExpr = '';
    let vExpr = '';

    // Split expression by semicolons
    const parts = splitByTopLevelSemicolons(expr).map(p => p.trim()).filter(Boolean);
    let helpers = [];
    let mainStatement = expr;
    let preprocessedHelpers = '';

    if (parts.length > 1) {
        helpers = parts.slice(0, parts.length - 1);
        mainStatement = parts[parts.length - 1];
        preprocessedHelpers = helpers.map(h => preprocessExpr(h)).join(';\n') + ';\n';
    }

    // Check for vector field: F(x,y) = (expr, expr)
    const outerMatch = mainStatement.match(/^([a-zA-Z])\(x\s*,\s*y\)\s*=\s*\((.*)\)$/);
    
    let vectorSplit = null;
    if (outerMatch) {
        const inner = outerMatch[2];
        let depth = 0;
        for (let i = 0; i < inner.length; i++) {
            if (inner[i] === '(' || inner[i] === '[' || inner[i] === '{') depth++;
            else if (inner[i] === ')' || inner[i] === ']' || inner[i] === '}') depth--;
            else if (inner[i] === ',' && depth === 0) {
                vectorSplit = [inner.substring(0, i).trim(), inner.substring(i + 1).trim()];
                break;
            }
        }
    }

    if (outerMatch && vectorSplit) {
        isVector = true;
        funcName = outerMatch[1].trim();
        uExpr = vectorSplit[0];
        vExpr = vectorSplit[1];
    } else if (mainStatement.includes('=')) {
        const eqIdx = mainStatement.indexOf('=');
        lhs = mainStatement.substring(0, eqIdx).trim();
        rhs = mainStatement.substring(eqIdx + 1).trim();
        
        if (!/^(y|f\(x\))$/i.test(lhs)) isImplicit = true;
    } else {
        rhs = mainStatement;
        lhs = 'y';
    }

    let type = '';
    let plotData = null;
    let latexText = '';
    let label = '';

    if (isVector) {
        type = 'vector';
        let uCompiled = math.compile(preprocessedHelpers + preprocessExpr(uExpr));
        let vCompiled = math.compile(preprocessedHelpers + preprocessExpr(vExpr));

        const steps = 16;
        const [xMin, xMax] = opts.xDomain;
        const [yMin, yMax] = opts.yDomain;
        const xStep = (xMax - xMin) / steps;
        const yStep = (yMax - yMin) / steps;

        const points = [];
        let maxMag = 0;

        for (let i = 0; i <= steps; i++) {
            const x = xMin + i * xStep;
            for (let j = 0; j <= steps; j++) {
                const y = yMin + j * yStep;
                try {
                    let u = toReal(uCompiled.evaluate({ x, y }));
                    let v = toReal(vCompiled.evaluate({ x, y }));
                    
                    if (!isNaN(u) && isFinite(u) && !isNaN(v) && isFinite(v)) {
                        const mag = Math.sqrt(u * u + v * v);
                        if (mag > maxMag) maxMag = mag;
                        points.push({ x, y, u, v, mag });
                    }
                } catch (e) {}
            }
        }

        plotData = {
            points: points.map(pt => ({
                x: pt.x, y: pt.y, u: pt.u, v: pt.v,
                norm: maxMag > 0 ? pt.mag / maxMag : 0
            })),
            scale: maxMag > 0 ? (xStep * 0.9) / maxMag : 0
        };

        try {
            const latexU = math.parse(uExpr).toTex();
            const latexV = math.parse(vExpr).toTex();
            latexText = `\\vec{${funcName}}(x,y) = \\begin{pmatrix} ${latexU} \\\\ ${latexV} \\end{pmatrix}`;
        } catch (e) {
            latexText = `\\vec{${funcName}}(x,y) = \\left( ${uExpr}, ${vExpr} \\right)`;
        }
        label = `${funcName}(x,y)`;
    } else if (!isImplicit) {
        type = 'explicit';
        let compiled = math.compile(preprocessedHelpers + preprocessExpr(rhs));

        const points = [];
        const [xMin, xMax] = opts.xDomain;
        const [yMin, yMax] = opts.yDomain;
        const steps = 400;
        const step = (xMax - xMin) / steps;

        function evalAt(x) {
            try {
                let val = toReal(compiled.evaluate({ x }));
                if (typeof val === 'number' && !isNaN(val) && isFinite(val)) return val;
            } catch (e) {}
            return null;
        }

        const maxDepth = 6;
        const minXDist = (xMax - xMin) / 100000;
        const yRange = yMax - yMin;
        const threshY = yRange * 0.01;
        const nearDomain = (y) => y !== null && y >= yMin - yRange && y <= yMax + yRange;

        function subdivide(x1, y1, x2, y2, depth) {
            let shouldSplit = false;
            let yMid = null;
            const xMid = (x1 + x2) / 2;

            if (depth < maxDepth && Math.abs(x2 - x1) >= minXDist) {
                yMid = evalAt(xMid);
                
                if (y1 === null && y2 === null) {
                    if (yMid !== null) shouldSplit = true;
                } else if (y1 === null || y2 === null) {
                    shouldSplit = true;
                } else {
                    const diff = Math.abs(y1 - y2);
                    if (diff > threshY && (nearDomain(y1) || nearDomain(y2) || nearDomain(yMid))) {
                        shouldSplit = true;
                    }
                }
            }

            if (shouldSplit) {
                subdivide(x1, y1, xMid, yMid, depth + 1);
                subdivide(xMid, yMid, x2, y2, depth + 1);
            } else {
                points.push({ x: x2, y: y2 });
            }
        }

        const yStart = evalAt(xMin);
        points.push({ x: xMin, y: yStart });

        for (let i = 0; i < steps; i++) {
            const x1 = xMin + i * step;
            const x2 = xMin + (i + 1) * step;
            const y1 = points[points.length - 1].y;
            const y2 = evalAt(x2);
            subdivide(x1, y1, x2, y2, 0);
        }

        plotData = points;

        try {
            const texLhs = lhs === 'y' ? 'y' : 'f(x)';
            const texRhs = math.parse(rhs).toTex();
            latexText = `${texLhs} = ${texRhs}`;
        } catch (e) {
            latexText = `${lhs} = ${rhs}`;
        }
        label = mainStatement;
    } else {
        type = 'implicit';
        const combined = preprocessedHelpers + `(${preprocessExpr(lhs)}) - (${preprocessExpr(rhs)})`;
        let compiled = math.compile(combined);

        const steps = 150;
        const [xMin, xMax] = opts.xDomain;
        const [yMin, yMax] = opts.yDomain;
        const xStep = (xMax - xMin) / steps;
        const yStep = (yMax - yMin) / steps;
        
        const X = [];
        const Y = [];
        for (let i = 0; i <= steps; i++) {
            X.push(xMin + i * xStep);
            Y.push(yMin + i * yStep);
        }

        const V = [];
        for (let i = 0; i <= steps; i++) {
            const row = [];
            const x = X[i];
            for (let j = 0; j <= steps; j++) {
                const y = Y[j];
                let val = NaN;
                try {
                    let res = toReal(compiled.evaluate({ x, y }));
                    if (typeof res === 'number' && !isNaN(res) && isFinite(res)) val = res;
                } catch (e) {
                    val = NaN;
                }
                row.push(val);
            }
            V.push(row);
        }
        plotData = { X, Y, V };

        try {
            latexText = `${math.parse(lhs).toTex()} = ${math.parse(rhs).toTex()}`;
        } catch (e) {
            latexText = `${lhs} = ${rhs}`;
        }
        label = mainStatement;
    }

    return { type, data: plotData, latexText, label };
}

async function renderPlot(rawExpr, customOptions = {}) {
    if (!isInitialized || !page) {
        return { success: false, error: 'Local renderer is not initialized.' };
    }

    try {
        const expr = rawExpr.trim();
        const graphStyle = config.style.graph || {};
        const opts = {
            width: graphStyle.width || 600,
            height: graphStyle.height || 450,
            gridColor: graphStyle.gridColor || 'rgba(255, 255, 255, 0.06)',
            axisColor: graphStyle.axisColor || 'rgba(255, 255, 255, 0.3)',
            axisLabelColor: graphStyle.axisLabelColor || 'rgba(248, 250, 252, 0.5)',
            curveColors: graphStyle.curveColors || ['#06b6d4', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#84cc16'],
            glowColor: graphStyle.glowColor || 'rgba(6, 182, 212, 0.4)',
            glowBlur: graphStyle.glowBlur || 10,
            lineWidth: graphStyle.lineWidth || 3.5,
            xDomain: customOptions.xDomain || graphStyle.defaultXDomain || [-10, 10],
            yDomain: customOptions.yDomain || graphStyle.defaultYDomain || [-10, 10],
            fontFamily: config.style.fontFamily || 'sans-serif'
        };

        const parts = splitByTopLevelCommas(expr).map(p => p.trim()).filter(Boolean);
        if (parts.length === 0) {
            return { success: false, error: 'No expressions to plot.' };
        }

        let type = '';
        let plotData = null;
        let latexText = '';

        if (parts.length === 1) {
            let parsed;
            try {
                parsed = parseSingleExpression(parts[0], opts);
            } catch (err) {
                return { success: false, error: `Parsing error in expression: ${err.message}` };
            }
            type = parsed.type;
            plotData = parsed.data;
            latexText = parsed.latexText;
        } else {
            type = 'multi';
            const plots = [];
            const latexParts = [];
            for (let i = 0; i < parts.length; i++) {
                try {
                    const parsed = parseSingleExpression(parts[i], opts);
                    plots.push(parsed);
                    latexParts.push(parsed.latexText);
                } catch (err) {
                    return { success: false, error: `Parsing error in expression "${parts[i]}": ${err.message}` };
                }
            }
            plotData = plots;
            latexText = latexParts.join(',\\quad ');
        }

        const renderResult = await page.evaluate((lat, t, pData, opt) => {
            return window.renderGraph(lat, t, pData, opt);
        }, latexText, type, plotData, opts);

        if (!renderResult.success) return { success: false, error: renderResult.error };

        const card = await page.$('#card');
        if (!card) return { success: false, error: 'Card element not found in DOM.' };

        const buf = await card.screenshot({ type: 'png', omitBackground: true });

        await page.evaluate(() => {
            const canvas = document.getElementById('graph-canvas');
            if (canvas) canvas.remove();
        });

        return { success: true, data: buf.toString('base64'), source: 'local-plot' };

    } catch (err) {
        console.error('Error during plot rendering:', err.message);
        return { success: false, error: err.message };
    }
}

async function renderOde(latexText, curves, customOptions = {}) {
    if (!isInitialized || !page) {
        return { success: false, error: 'Local renderer is not initialized.' };
    }

    try {
        const graphStyle = config.style.graph || {};
        const opts = {
            width: graphStyle.width || 600,
            height: graphStyle.height || 450,
            gridColor: graphStyle.gridColor || 'rgba(255, 255, 255, 0.06)',
            axisColor: graphStyle.axisColor || 'rgba(255, 255, 255, 0.3)',
            axisLabelColor: graphStyle.axisLabelColor || 'rgba(248, 250, 252, 0.5)',
            curveColors: graphStyle.curveColors || ['#06b6d4', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#84cc16'],
            glowColor: graphStyle.glowColor || 'rgba(6, 182, 212, 0.4)',
            glowBlur: graphStyle.glowBlur || 10,
            lineWidth: graphStyle.lineWidth || 3.5,
            xDomain: customOptions.xDomain || graphStyle.defaultXDomain || [-10, 10],
            yDomain: customOptions.yDomain || graphStyle.defaultYDomain || [-10, 10],
            fontFamily: config.style.fontFamily || 'sans-serif'
        };

        const renderResult = await page.evaluate((lat, t, pData, opt) => {
            return window.renderGraph(lat, t, pData, opt);
        }, latexText, 'ode_curves', curves, opts);

        if (!renderResult.success) return { success: false, error: renderResult.error };

        const card = await page.$('#card');
        if (!card) return { success: false, error: 'Card element not found in DOM.' };

        const buf = await card.screenshot({ type: 'png', omitBackground: true });

        await page.evaluate(() => {
            const canvas = document.getElementById('graph-canvas');
            if (canvas) canvas.remove();
        });

        return { success: true, data: buf.toString('base64'), source: 'local-ode' };

    } catch (err) {
        console.error('Error during ODE plot rendering:', err.message);
        return { success: false, error: err.message };
    }
}

module.exports = {
    initialize,
    render,
    renderChem,
    renderTikz,
    renderPlot,
    renderOde,
    close,
    isLocalReady: () => isInitialized,
    isRateLimited,
    validateInputLength
};
