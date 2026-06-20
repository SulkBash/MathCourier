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
// Insert implicit multiplication between adjacent x/y/t variables for mathjs
function preprocessExpr(expr) {
    if (!expr) return '';

    const symbols = new Set(['x', 'y', 't']);
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
            let skip = true;
            let nextIndex = i + 1;
            while (nextIndex < expr.length && /\s/.test(expr[nextIndex])) {
                nextIndex++;
            }
            if (nextIndex < expr.length && symbols.has(expr[nextIndex].toLowerCase())) {
                skip = false;
            }
            if (/\d/.test(prevChar)) {
                skip = false;
            }
            if (skip) {
                continue;
            }
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
    const vectorOrParametricTuple = namedVectorField ? null : parseVectorTuple(mainStatement, 2);

    let isParametric = false;
    let parametricTuple = null;

    if (vectorOrParametricTuple && vectorOrParametricTuple.some(comp => /\bt\b/i.test(comp))) {
        isParametric = true;
        parametricTuple = vectorOrParametricTuple;
    }

    let isExplicitPolar = false;
    let isPolar = false;

    if (namedVectorField) {
        isVector = true;
        hasExplicitVectorName = true;
        funcName = namedVectorField.name;
        [uExpr, vExpr] = namedVectorField.components;
    } else if (vectorOrParametricTuple && !isParametric) {
        isVector = true;
        [uExpr, vExpr] = vectorOrParametricTuple;
    } else if (mainStatement.includes('=')) {
        const eqIdx = mainStatement.indexOf('=');
        lhs = mainStatement.substring(0, eqIdx).trim();
        rhs = mainStatement.substring(eqIdx + 1).trim();
        
        if (lhs.toLowerCase() === 'r') {
            isPolar = true;
            isExplicitPolar = true;
        } else if (/\br\b/i.test(mainStatement) || /\btheta\b/i.test(mainStatement)) {
            isPolar = true;
            isImplicit = true;
        } else if (!/^(y|f\(x\))$/i.test(lhs)) {
            isImplicit = true;
        }
    } else {
        if (/\btheta\b/i.test(mainStatement)) {
            isPolar = true;
            isExplicitPolar = true;
            lhs = 'r';
            rhs = mainStatement;
        } else {
            rhs = mainStatement;
            lhs = 'y';
        }
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
            if (opts.tracingVar === 'x' && opts.tracingLimit !== undefined && x > opts.tracingLimit) {
                continue;
            }
            for (let j = 0; j <= steps; j++) {
                const y = yMin + j * yStep;
                if (opts.tracingVar === 'y' && opts.tracingLimit !== undefined && y > opts.tracingLimit) {
                    continue;
                }
                try {
                    const scope = Object.assign({ x, y }, opts.evalScope || {});
                    let u = toReal(uCompiled.evaluate(scope));
                    let v = toReal(vCompiled.evaluate(scope));
                    
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
    } else if (isParametric) {
        type = 'parametric';
        const [xExpr, yExpr] = parametricTuple;
        const xCompiled = math.compile(preprocessedHelpers + preprocessExpr(xExpr));
        const yCompiled = math.compile(preprocessedHelpers + preprocessExpr(yExpr));

        const points = [];
        const [tMin, tMax] = opts.parameterDomain || [0, 2 * Math.PI];
        const steps = 500;
        const step = (tMax - tMin) / steps;

        const limitT = (opts.tracingVar === 't' && opts.tracingLimit !== undefined) ? opts.tracingLimit : tMax;
        for (let i = 0; i <= steps; i++) {
            const t = tMin + i * step;
            if (t > limitT) break;
            try {
                const scope = Object.assign({ t }, opts.evalScope || {});
                const xVal = toReal(xCompiled.evaluate(scope));
                const yVal = toReal(yCompiled.evaluate(scope));
                if (typeof xVal === 'number' && !isNaN(xVal) && isFinite(xVal) &&
                    typeof yVal === 'number' && !isNaN(yVal) && isFinite(yVal)) {
                    points.push({ x: xVal, y: yVal });
                } else {
                    points.push({ x: null, y: null });
                }
            } catch (e) {
                points.push({ x: null, y: null });
            }
        }

        plotData = points;
        try {
            const latexX = math.parse(xExpr).toTex();
            const latexY = math.parse(yExpr).toTex();
            latexText = `\\left( ${latexX},\\ ${latexY} \\right)`;
        } catch (e) {
            latexText = `\\left( ${xExpr},\\ ${yExpr} \\right)`;
        }
        label = mainStatement;
    } else if (isExplicitPolar) {
        type = 'polar';
        const rCompiled = math.compile(preprocessedHelpers + preprocessExpr(rhs));

        const points = [];
        const [thetaMin, thetaMax] = opts.parameterDomain || [0, 2 * Math.PI];
        const steps = 500;
        const step = (thetaMax - thetaMin) / steps;

        const limitTheta = (opts.tracingVar === 'theta' && opts.tracingLimit !== undefined) ? opts.tracingLimit : thetaMax;
        for (let i = 0; i <= steps; i++) {
            const theta = thetaMin + i * step;
            if (theta > limitTheta) break;
            try {
                const scope = Object.assign({ theta }, opts.evalScope || {});
                const rVal = toReal(rCompiled.evaluate(scope));
                if (typeof rVal === 'number' && !isNaN(rVal) && isFinite(rVal)) {
                    const xVal = rVal * Math.cos(theta);
                    const yVal = rVal * Math.sin(theta);
                    points.push({ x: xVal, y: yVal });
                } else {
                    points.push({ x: null, y: null });
                }
            } catch (e) {
                points.push({ x: null, y: null });
            }
        }

        plotData = points;
        try {
            const latexR = math.parse(rhs).toTex();
            latexText = `r = ${latexR}`;
        } catch (e) {
            latexText = `r = ${rhs}`;
        }
        label = mainStatement;
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
                const scope = Object.assign({ x }, opts.evalScope || {});
                let val = toReal(compiled.evaluate(scope));
                if (typeof val === 'number' && !isNaN(val) && isFinite(val)) {
                    if (opts.tracingVar === 'y' && opts.tracingLimit !== undefined && val > opts.tracingLimit) {
                        return null;
                    }
                    return val;
                }
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

        const limitX = (opts.tracingVar === 'x' && opts.tracingLimit !== undefined) ? opts.tracingLimit : xMax;
        for (let i = 0; i < steps; i++) {
            const x1 = xMin + i * step;
            const x2 = xMin + (i + 1) * step;
            if (x2 > limitX) break;
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
            const skipX = opts.tracingVar === 'x' && opts.tracingLimit !== undefined && x > opts.tracingLimit;
            for (let j = 0; j <= steps; j++) {
                const y = Y[j];
                const skipY = opts.tracingVar === 'y' && opts.tracingLimit !== undefined && y > opts.tracingLimit;
                if (skipX || skipY) {
                    row.push(NaN);
                    continue;
                }
                let val = NaN;
                try {
                    const r = Math.sqrt(x * x + y * y);
                    const theta = Math.atan2(y, x);
                    const scope = Object.assign({ x, y, r, theta }, opts.evalScope || {});
                    let res = toReal(compiled.evaluate(scope));
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
        const parts = splitByTopLevelCommas(expr).map(p => p.trim()).filter(Boolean);
        if (parts.length === 0) {
            return { success: false, error: 'No expressions to plot.' };
        }

        // Detection helper for parametric and polar
        let isParametricOrPolar = false;
        for (const part of parts) {
            const trimmed = part.toLowerCase();
            const tuple = parseVectorTuple(part, 2);
            const isParametric = tuple && tuple.some(comp => /\bt\b/i.test(comp));
            const isPolar = trimmed.startsWith('r=') || trimmed.includes('r =') || /\btheta\b/i.test(trimmed);
            if (isParametric || isPolar) {
                isParametricOrPolar = true;
                break;
            }
        }

        const isAnimated = customOptions.isAnimated || false;
        let animVar = customOptions.animationVar;
        if (isAnimated && !animVar) {
            // Auto-detect: if expression contains 't' and it's not parametric/polar, default to 't' (parameter sweep)
            const hasT = parts.some(part => /\bt\b/i.test(part));
            if (hasT && !isParametricOrPolar) {
                animVar = 't';
            } else {
                animVar = 'x';
            }
        }

        let isTracingMode = false;
        let tracingVar = null;
        if (isAnimated) {
            let indepVars = [];
            if (isParametricOrPolar) {
                indepVars = ['t', 'theta'];
            } else {
                indepVars = ['x', 'y'];
            }
            if (indepVars.includes(animVar)) {
                isTracingMode = true;
                tracingVar = animVar;
            }
        }

        const domains = customOptions.domains || [];
        let xDomain, yDomain, parameterDomain, paramDomain;
        const graphStyle = config.style.graph || {};

        if (isAnimated && !isTracingMode) {
            // Parameter Sweep Mode
            if (isParametricOrPolar) {
                parameterDomain = domains.length >= 1 ? domains[0] : [0, 2 * Math.PI];
                if (domains.length >= 2) {
                    paramDomain = domains[1];
                    xDomain = domains.length >= 3 ? domains[2] : (graphStyle.defaultXDomain || [-10, 10]);
                    yDomain = domains.length >= 4 ? domains[3] : (domains.length === 3 ? domains[2] : (graphStyle.defaultYDomain || [-10, 10]));
                } else {
                    paramDomain = [0, 2 * Math.PI];
                    xDomain = graphStyle.defaultXDomain || [-10, 10];
                    yDomain = graphStyle.defaultYDomain || [-10, 10];
                }
            } else {
                parameterDomain = null;
                xDomain = domains.length >= 1 ? domains[0] : (graphStyle.defaultXDomain || [-10, 10]);
                if (domains.length >= 2) {
                    paramDomain = domains[1];
                    yDomain = domains.length >= 3 ? domains[2] : (graphStyle.defaultYDomain || [-10, 10]);
                } else {
                    paramDomain = [0, 2 * Math.PI];
                    yDomain = graphStyle.defaultYDomain || [-10, 10];
                }
            }
        } else {
            // Static or Tracing Mode (no separate animation parameter)
            paramDomain = null;
            if (isParametricOrPolar) {
                parameterDomain = domains.length >= 1 ? domains[0] : [0, 2 * Math.PI];
                xDomain = domains.length >= 2 ? domains[1] : (graphStyle.defaultXDomain || [-10, 10]);
                if (domains.length >= 3) {
                    yDomain = domains[2];
                } else if (domains.length === 2) {
                    yDomain = domains[1];
                } else {
                    yDomain = graphStyle.defaultYDomain || [-10, 10];
                }
            } else {
                parameterDomain = null;
                xDomain = domains.length >= 1 ? domains[0] : (graphStyle.defaultXDomain || [-10, 10]);
                yDomain = domains.length >= 2 ? domains[1] : (graphStyle.defaultYDomain || [-10, 10]);
            }
        }

        if (isAnimated) {
            let animPage = null;
            try {
                animPage = await katexModule.createRenderPage();
                const totalFrames = 20;
                const frameBuffers = [];

                for (let f = 0; f < totalFrames; f++) {
                    const progress = (f + 1) / totalFrames; // 5% to 100%

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
                        xDomain,
                        yDomain,
                        parameterDomain,
                        fontFamily: config.style.fontFamily || 'sans-serif'
                    };

                    if (isTracingMode) {
                        opts.tracingVar = tracingVar;
                        if (tracingVar === 'x') {
                            opts.tracingLimit = xDomain[0] + progress * (xDomain[1] - xDomain[0]);
                        } else if (tracingVar === 'y') {
                            opts.tracingLimit = yDomain[0] + progress * (yDomain[1] - yDomain[0]);
                        } else if (tracingVar === 't' || tracingVar === 'theta') {
                            opts.tracingLimit = parameterDomain[0] + progress * (parameterDomain[1] - parameterDomain[0]);
                        }
                    } else {
                        const paramVal = paramDomain[0] + progress * (paramDomain[1] - paramDomain[0]);
                        opts.evalScope = { [animVar]: paramVal };
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
                        if (!isTracingMode) {
                            const val = opts.evalScope[animVar];
                            latexText += `\\quad (${animVar} = ${val.toFixed(2)})`;
                        }
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
                        if (!isTracingMode) {
                            const val = opts.evalScope[animVar];
                            latexText += `\\quad (${animVar} = ${val.toFixed(2)})`;
                        }
                    }

                    const renderResult = await animPage.evaluate((lat, t, pData, opt) => {
                        return window.renderGraph(lat, t, pData, opt);
                    }, latexText, type, plotData, opts);

                    if (!renderResult.success) {
                        return { success: false, error: renderResult.error };
                    }

                    const card = await animPage.$('#card');
                    if (!card) return { success: false, error: 'Card element not found in DOM.' };

                    const buf = await card.screenshot({ type: 'jpeg', quality: 85 });
                    frameBuffers.push(buf);

                    await animPage.evaluate(() => {
                        const canvas = document.getElementById('graph-canvas');
                        if (canvas) canvas.remove();
                    });
                }

                const { compileVideo } = require('./plot3d');
                const videoBuf = await compileVideo(frameBuffers, 10);
                return {
                    success: true,
                    data: videoBuf.toString('base64'),
                    mimeType: 'video/mp4',
                    filename: 'plot2d.mp4',
                    source: 'local-plot-2d-anim',
                    isAnimation: true
                };

            } catch (err) {
                console.error('Error during 2D plot animation rendering:', err.message);
                return { success: false, error: err.message };
            } finally {
                if (animPage) {
                    try { await animPage.close(); } catch (e) {}
                }
            }
        } else {
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
                xDomain,
                yDomain,
                parameterDomain,
                fontFamily: config.style.fontFamily || 'sans-serif'
            };

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
        }

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
