const math = require('../math');
const config = require('../../config');
const katexModule = require('./katex');

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

// Insert implicit multiplication between adjacent x/y variables for mathjs
function preprocessExpr(expr) {
    if (!expr) return '';

    const symbols = new Set(['x', 'y']);
    const isIdentifierChar = (char) => /[A-Za-z0-9_]/.test(char);
    let result = '';
    let inQuotes = false;
    let quoteChar = null;

    for (let i = 0; i < expr.length; i++) {
        const char = expr[i];

        if (inQuotes) {
            result += char;
            if (char === '\\' && i + 1 < expr.length) {
                result += expr[i + 1];
                i++;
            } else if (char === quoteChar) {
                inQuotes = false;
                quoteChar = null;
            }
            continue;
        }

        if (char === '"' || char === '\'') {
            inQuotes = true;
            quoteChar = char;
            result += char;
            continue;
        }

        result += char;

        if (!symbols.has(char.toLowerCase())) {
            continue;
        }

        const prevChar = i > 0 ? expr[i - 1] : '';
        if (prevChar && isIdentifierChar(prevChar)) {
            continue;
        }

        let nextIndex = i + 1;
        while (nextIndex < expr.length && /\s/.test(expr[nextIndex])) {
            nextIndex++;
        }

        if (nextIndex >= expr.length) {
            continue;
        }

        const nextChar = expr[nextIndex];
        if (symbols.has(nextChar.toLowerCase()) || nextChar === '(') {
            result += '*';
        }
    }

    return result;
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

function parseVectorTuple(expr, expectedDimension = null) {
    const trimmed = String(expr || '').trim();
    if (!trimmed) {
        return null;
    }

    const hasParens = trimmed.startsWith('(') && trimmed.endsWith(')');
    const hasBrackets = trimmed.startsWith('[') && trimmed.endsWith(']');
    if (!hasParens && !hasBrackets) {
        return null;
    }

    const components = splitByTopLevelCommas(trimmed.slice(1, -1))
        .map((component) => component.trim())
        .filter(Boolean);

    if (expectedDimension !== null && components.length !== expectedDimension) {
        return null;
    }

    return components;
}

function parseNamedVectorField(expr) {
    const match = expr.match(/^([A-Za-z][A-Za-z0-9_]*)\(\s*x\s*,\s*y\s*\)\s*=\s*(.+)$/);
    if (!match) {
        return null;
    }

    const components = parseVectorTuple(match[2], 2);
    if (!components) {
        return null;
    }

    return {
        name: match[1],
        components
    };
}

function parseSingleExpression(expr, opts) {
    let isImplicit = false;
    let isVector = false;
    let lhs = '';
    let rhs = '';
    let funcName = 'F';
    let hasExplicitVectorName = false;
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

    const namedVectorField = parseNamedVectorField(mainStatement);
    const implicitVectorField = namedVectorField ? null : parseVectorTuple(mainStatement, 2);

    if (namedVectorField) {
        isVector = true;
        hasExplicitVectorName = true;
        funcName = namedVectorField.name;
        [uExpr, vExpr] = namedVectorField.components;
    } else if (implicitVectorField) {
        isVector = true;
        [uExpr, vExpr] = implicitVectorField;
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
        label = hasExplicitVectorName ? `${funcName}(x,y)` : mainStatement;
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
    const isInitialized = katexModule.isInitialized();
    const page = katexModule.getPage();
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
    const isInitialized = katexModule.isInitialized();
    const page = katexModule.getPage();
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
    renderPlot,
    renderOde,
    splitByTopLevelCommas
};
