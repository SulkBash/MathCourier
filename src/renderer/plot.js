const math = require('../math');
const config = require('../../config');
const katexModule = require('./katex');
const { formatVarToTex } = require('../utils');
const { analyze2dPlot, extractExpressionVariables } = require('../plot-semantics');

const DEFAULT_PLOT2D_ANIMATION_FRAMES = Math.max(8, Number(config.bot?.plot2dAnimationFrames) || 20);
const DEFAULT_PLOT2D_ANIMATION_FPS = Math.max(4, Number(config.bot?.plot2dAnimationFps) || 10);

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

function parseSingleExpressionStructured(expr, opts) {
    const semantics = opts.semantics || analyze2dPlot(expr, opts);
    const mainStatement = expr.trim();
    let type = '';
    let plotData = null;
    let latexText = '';
    let label = mainStatement;

    if (semantics.family === 'vector') {
        type = 'vector';
        const [uExpr, vExpr] = semantics.components;
        const [xVar, yVar] = semantics.coordVars;
        const uCompiled = math.compile(preprocessExpr(uExpr));
        const vCompiled = math.compile(preprocessExpr(vExpr));

        const steps = 16;
        const [xMin, xMax] = opts.xDomain;
        const [yMin, yMax] = opts.yDomain;
        const xStep = (xMax - xMin) / steps;
        const yStep = (yMax - yMin) / steps;
        const points = [];
        let maxMag = 0;

        for (let i = 0; i <= steps; i++) {
            const x = xMin + i * xStep;
            if (opts.tracingVar === xVar && opts.tracingLimit !== undefined && x > opts.tracingLimit) {
                continue;
            }
            for (let j = 0; j <= steps; j++) {
                const y = yMin + j * yStep;
                if (opts.tracingVar === yVar && opts.tracingLimit !== undefined && y > opts.tracingLimit) {
                    continue;
                }
                try {
                    const scope = Object.assign(
                        { x, y, [xVar]: x, [yVar]: y },
                        opts.evalScope || {}
                    );
                    const u = toReal(uCompiled.evaluate(scope));
                    const v = toReal(vCompiled.evaluate(scope));
                    if (!isNaN(u) && isFinite(u) && !isNaN(v) && isFinite(v)) {
                        const mag = Math.sqrt(u * u + v * v);
                        if (mag > maxMag) maxMag = mag;
                        points.push({ x, y, u, v, mag });
                    }
                } catch (_) { }
            }
        }

        plotData = {
            points: points.map((pt) => ({
                x: pt.x,
                y: pt.y,
                u: pt.u,
                v: pt.v,
                norm: maxMag > 0 ? pt.mag / maxMag : 0
            })),
            scale: maxMag > 0 ? (xStep * 0.9) / maxMag : 0
        };

        try {
            latexText = `\\vec{${semantics.funcName}}(${xVar},${yVar}) = \\begin{pmatrix} ${math.parse(uExpr).toTex()} \\\\ ${math.parse(vExpr).toTex()} \\end{pmatrix}`;
        } catch (_) {
            latexText = `\\vec{${semantics.funcName}}(${xVar},${yVar}) = \\left( ${uExpr}, ${vExpr} \\right)`;
        }
    } else if (semantics.family === 'parametric') {
        type = 'parametric';
        const [xExpr, yExpr] = semantics.components;
        const paramVar = semantics.parameterVar;
        const xCompiled = math.compile(preprocessExpr(xExpr));
        const yCompiled = math.compile(preprocessExpr(yExpr));
        const points = [];
        const [tMin, tMax] = opts.parameterDomain || [0, 2 * Math.PI];
        const steps = 500;
        const step = (tMax - tMin) / steps;
        const limitT = (opts.tracingVar === paramVar && opts.tracingLimit !== undefined) ? opts.tracingLimit : tMax;

        for (let i = 0; i <= steps; i++) {
            const t = tMin + i * step;
            if (t > limitT) break;
            try {
                const scope = Object.assign({ t, [paramVar]: t }, opts.evalScope || {});
                const xVal = toReal(xCompiled.evaluate(scope));
                const yVal = toReal(yCompiled.evaluate(scope));
                if (typeof xVal === 'number' && !isNaN(xVal) && isFinite(xVal) &&
                    typeof yVal === 'number' && !isNaN(yVal) && isFinite(yVal)) {
                    points.push({ x: xVal, y: yVal });
                } else {
                    points.push({ x: null, y: null });
                }
            } catch (_) {
                points.push({ x: null, y: null });
            }
        }

        plotData = points;
        try {
            latexText = `\\left( ${math.parse(xExpr).toTex()},\\ ${math.parse(yExpr).toTex()} \\right)`;
        } catch (_) {
            latexText = `\\left( ${xExpr},\\ ${yExpr} \\right)`;
        }
    } else if (semantics.family === 'polar') {
        type = 'polar';
        const angleVar = semantics.angleVar;
        const rCompiled = math.compile(preprocessExpr(semantics.rhs));
        const points = [];
        const [thetaMin, thetaMax] = opts.parameterDomain || [0, 2 * Math.PI];
        const steps = 500;
        const step = (thetaMax - thetaMin) / steps;
        const limitTheta = (opts.tracingVar === angleVar && opts.tracingLimit !== undefined) ? opts.tracingLimit : thetaMax;

        for (let i = 0; i <= steps; i++) {
            const theta = thetaMin + i * step;
            if (theta > limitTheta) break;
            try {
                const scope = Object.assign({ theta, [angleVar]: theta }, opts.evalScope || {});
                const rVal = toReal(rCompiled.evaluate(scope));
                if (typeof rVal === 'number' && !isNaN(rVal) && isFinite(rVal)) {
                    points.push({
                        x: rVal * Math.cos(theta),
                        y: rVal * Math.sin(theta)
                    });
                } else {
                    points.push({ x: null, y: null });
                }
            } catch (_) {
                points.push({ x: null, y: null });
            }
        }

        plotData = points;
        try {
            latexText = `${semantics.lhs || 'r'} = ${math.parse(semantics.rhs).toTex()}`;
        } catch (_) {
            latexText = `${semantics.lhs || 'r'} = ${semantics.rhs}`;
        }
    } else if (semantics.family === 'explicit') {
        type = 'explicit';
        const independentVar = semantics.independentVar;
        const dependentVar = semantics.dependentVar || 'y';
        const compiled = math.compile(preprocessExpr(semantics.rhs));
        const points = [];
        const [xMin, xMax] = opts.xDomain;
        const [yMin, yMax] = opts.yDomain;
        const steps = 400;
        const step = (xMax - xMin) / steps;

        function evalAt(x) {
            try {
                const scope = Object.assign({ x, [independentVar]: x }, opts.evalScope || {});
                const val = toReal(compiled.evaluate(scope));
                if (typeof val === 'number' && !isNaN(val) && isFinite(val)) {
                    if (opts.tracingVar === dependentVar && opts.tracingLimit !== undefined && val > opts.tracingLimit) {
                        return null;
                    }
                    return val;
                }
            } catch (_) { }
            return null;
        }

        const maxDepth = 12;
        const minXDist = (xMax - xMin) / 1000000;
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

        const limitX = (opts.tracingVar === independentVar && opts.tracingLimit !== undefined) ? opts.tracingLimit : xMax;
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
            latexText = `${semantics.lhs || dependentVar} = ${math.parse(semantics.rhs).toTex()}`;
        } catch (_) {
            latexText = `${semantics.lhs || dependentVar} = ${semantics.rhs}`;
        }
    } else {
        type = 'implicit';
        const lhs = semantics.lhs;
        const rhs = semantics.rhs;
        const [xVar, yVar] = semantics.coordVars || ['x', 'y'];
        const combined = `(${preprocessExpr(lhs)}) - (${preprocessExpr(rhs)})`;
        const compiled = math.compile(combined);
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
            const skipX = opts.tracingVar === xVar && opts.tracingLimit !== undefined && x > opts.tracingLimit;
            for (let j = 0; j <= steps; j++) {
                const y = Y[j];
                const skipY = opts.tracingVar === yVar && opts.tracingLimit !== undefined && y > opts.tracingLimit;
                if (skipX || skipY) {
                    row.push(NaN);
                    continue;
                }

                let val = NaN;
                try {
                    const r = Math.sqrt(x * x + y * y);
                    const theta = Math.atan2(y, x);
                    const scope = Object.assign(
                        { x, y, [xVar]: x, [yVar]: y, r, theta },
                        semantics.family === 'implicit-polar'
                            ? { [semantics.angleVar]: theta }
                            : null,
                        opts.evalScope || {}
                    );
                    const res = toReal(compiled.evaluate(scope));
                    if (typeof res === 'number' && !isNaN(res) && isFinite(res)) {
                        val = res;
                    }
                } catch (_) {
                    val = NaN;
                }
                row.push(val);
            }
            V.push(row);
        }

        plotData = { X, Y, V };
        try {
            latexText = `${math.parse(lhs).toTex()} = ${math.parse(rhs).toTex()}`;
        } catch (_) {
            latexText = `${lhs} = ${rhs}`;
        }
    }

    return { type, data: plotData, latexText, label };
}

function parseSingleExpression(expr, opts) {
    if (opts && opts.semanticMode) {
        return parseSingleExpressionStructured(expr, opts);
    }

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

        const maxDepth = 12;
        const minXDist = (xMax - xMin) / 1000000;
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

async function renderPlot(rawExpr, customOptions = {}, renderPage = null) {
    const isInitialized = katexModule.isInitialized();
    const page = renderPage || katexModule.getPage();
    if (!isInitialized || !page) {
        return { success: false, error: 'Local renderer is not initialized.' };
    }

    try {
        const expr = rawExpr.trim();
        const parts = splitByTopLevelCommas(expr).map(p => p.trim()).filter(Boolean);
        if (parts.length === 0) {
            return { success: false, error: 'No expressions to plot.' };
        }

        const semantics = parts.length === 1
            ? analyze2dPlot(parts[0], {
                kind: customOptions.kind,
                variables: customOptions.variables,
                labeledDomains: customOptions.labeledDomains
            })
            : null;

        const traceVars = semantics
            ? (() => {
                switch (semantics.family) {
                    case 'parametric':
                        return [semantics.parameterVar];
                    case 'polar':
                    case 'implicit-polar':
                        return [semantics.angleVar];
                    case 'vector':
                    case 'implicit':
                        return semantics.coordVars || [];
                    case 'explicit':
                        return [semantics.independentVar, semantics.dependentVar].filter(Boolean);
                    default:
                        return [];
                }
            })()
            : [];

        let isParametricOrPolar = false;
        if (semantics) {
            isParametricOrPolar = ['parametric', 'polar', 'implicit-polar'].includes(semantics.family);
        } else {
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
        }

        const isAnimated = customOptions.isAnimated || false;
        let animVar = customOptions.animationVar;
        if (isAnimated && !animVar) {
            if (semantics) {
                const exprVars = extractExpressionVariables(parts[0]);
                const semanticVars = new Set([
                    ...(semantics.coordVars || []),
                    ...(semantics.parameterVar ? [semantics.parameterVar] : []),
                    ...(semantics.angleVar ? [semantics.angleVar] : []),
                    ...(semantics.independentVar ? [semantics.independentVar] : []),
                    ...(semantics.dependentVar ? [semantics.dependentVar] : [])
                ]);
                const sweepVar = exprVars.find((name) => !semanticVars.has(name));
                animVar = sweepVar || traceVars[0] || 'x';
            } else {
                const hasT = parts.some(part => /\bt\b/i.test(part));
                if (hasT && !isParametricOrPolar) {
                    animVar = 't';
                } else {
                    animVar = 'x';
                }
            }
        }

        let isTracingMode = false;
        let tracingVar = null;
        if (isAnimated) {
            let indepVars = [];
            if (semantics) {
                indepVars = traceVars;
            } else if (isParametricOrPolar) {
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
        const labeled = customOptions.labeledDomains || {};
        let positionalConsumed = 0;

        function resolveDomainForVar(varNames, fallbackDefault) {
            const names = Array.isArray(varNames) ? varNames : [varNames];
            for (const name of names) {
                if (labeled[name]) {
                    return labeled[name];
                }
            }
            if (positionalConsumed < domains.length) {
                const domain = domains[positionalConsumed];
                positionalConsumed++;
                return domain;
            }
            return typeof fallbackDefault === 'function' ? fallbackDefault() : fallbackDefault;
        }

        let xDomain, yDomain, parameterDomain, paramDomain;
        const graphStyle = config.style.graph || {};

        if (semantics) {
            const defaultX = graphStyle.defaultXDomain || [-10, 10];
            const defaultY = graphStyle.defaultYDomain || [-10, 10];

            if (semantics.family === 'parametric') {
                parameterDomain = resolveDomainForVar(semantics.parameterVar, [0, 2 * Math.PI]);
                xDomain = resolveDomainForVar('x', defaultX);
                yDomain = resolveDomainForVar('y', defaultY);
            } else if (semantics.family === 'polar' || semantics.family === 'implicit-polar') {
                parameterDomain = resolveDomainForVar(semantics.angleVar, [0, 2 * Math.PI]);
                xDomain = resolveDomainForVar('x', defaultX);
                yDomain = resolveDomainForVar('y', defaultY);
            } else if (semantics.family === 'vector' || semantics.family === 'implicit') {
                xDomain = resolveDomainForVar(semantics.coordVars[0], defaultX);
                yDomain = resolveDomainForVar(semantics.coordVars[1], defaultY);
            } else {
                xDomain = resolveDomainForVar(semantics.independentVar, defaultX);
                yDomain = resolveDomainForVar(semantics.dependentVar, defaultY);
            }

            if (isAnimated && !isTracingMode) {
                paramDomain = resolveDomainForVar(animVar || 't', [0, 2 * Math.PI]);
            } else {
                paramDomain = null;
            }
        } else if (isAnimated && !isTracingMode) {
            if (isParametricOrPolar) {
                parameterDomain = resolveDomainForVar(['t', 'theta'], [0, 2 * Math.PI]);
                paramDomain = resolveDomainForVar(animVar || 't', [0, 2 * Math.PI]);

                const hasPosForX = (labeled['x'] !== undefined) || (positionalConsumed < domains.length);
                xDomain = resolveDomainForVar('x', graphStyle.defaultXDomain || [-10, 10]);

                const hasPosForY = (labeled['y'] !== undefined) || (positionalConsumed < domains.length);
                yDomain = resolveDomainForVar('y', () => {
                    if (hasPosForX && !hasPosForY) return [...xDomain];
                    return graphStyle.defaultYDomain || [-10, 10];
                });
            } else {
                parameterDomain = null;
                xDomain = resolveDomainForVar('x', graphStyle.defaultXDomain || [-10, 10]);
                paramDomain = resolveDomainForVar(animVar || 't', [0, 2 * Math.PI]);
                yDomain = resolveDomainForVar('y', graphStyle.defaultYDomain || [-10, 10]);
            }
        } else {
            paramDomain = null;
            if (isParametricOrPolar) {
                parameterDomain = resolveDomainForVar(['t', 'theta'], [0, 2 * Math.PI]);

                const hasPosForX = (labeled['x'] !== undefined) || (positionalConsumed < domains.length);
                xDomain = resolveDomainForVar('x', graphStyle.defaultXDomain || [-10, 10]);

                const hasPosForY = (labeled['y'] !== undefined) || (positionalConsumed < domains.length);
                yDomain = resolveDomainForVar('y', () => {
                    if (hasPosForX && !hasPosForY) return [...xDomain];
                    return graphStyle.defaultYDomain || [-10, 10];
                });
            } else {
                parameterDomain = null;
                xDomain = resolveDomainForVar('x', graphStyle.defaultXDomain || [-10, 10]);
                yDomain = resolveDomainForVar('y', graphStyle.defaultYDomain || [-10, 10]);
            }
        }

        if (isAnimated) {
            let animPage = renderPage;
            let shouldCloseAnimPage = false;
            try {
                if (!animPage) {
                    animPage = await katexModule.createRenderPage();
                    shouldCloseAnimPage = true;
                }
                const totalFrames = DEFAULT_PLOT2D_ANIMATION_FRAMES;
                const frameBuffers = [];

                let traceMin = null;
                let traceMax = null;

                if (isTracingMode) {
                    if (semantics && semantics.family === 'parametric' && tracingVar === semantics.parameterVar) {
                        traceMin = parameterDomain[0];
                        traceMax = parameterDomain[1];
                    } else if (semantics && (semantics.family === 'polar' || semantics.family === 'implicit-polar') && tracingVar === semantics.angleVar) {
                        traceMin = parameterDomain[0];
                        traceMax = parameterDomain[1];
                    } else if (semantics && (semantics.family === 'vector' || semantics.family === 'implicit') && tracingVar === semantics.coordVars[0]) {
                        traceMin = xDomain[0];
                        traceMax = xDomain[1];
                    } else if (semantics && (semantics.family === 'vector' || semantics.family === 'implicit') && tracingVar === semantics.coordVars[1]) {
                        traceMin = yDomain[0];
                        traceMax = yDomain[1];
                    } else if (semantics && semantics.family === 'explicit' && tracingVar === semantics.independentVar) {
                        traceMin = xDomain[0];
                        traceMax = xDomain[1];
                    } else if (semantics && semantics.family === 'explicit' && tracingVar === semantics.dependentVar) {
                        traceMin = yDomain[0];
                        traceMax = yDomain[1];
                    } else if (tracingVar === 'x') {
                        traceMin = xDomain[0];
                        traceMax = xDomain[1];
                    } else if (tracingVar === 'y') {
                        traceMin = yDomain[0];
                        traceMax = yDomain[1];
                    } else if (tracingVar === 't' || tracingVar === 'theta') {
                        traceMin = parameterDomain[0];
                        traceMax = parameterDomain[1];
                    }

                    // Pre-evaluate to find the actual active bounds of the curve
                    const staticOpts = {
                        xDomain,
                        yDomain,
                        parameterDomain,
                        semanticMode: !!semantics,
                        semantics
                    };

                    let parsedPlots = [];
                    for (const part of parts) {
                        try {
                            const parsed = parseSingleExpression(part, staticOpts);
                            parsedPlots.push(parsed);
                        } catch (e) {}
                    }

                    let minValid = Infinity;
                    let maxValid = -Infinity;
                    let foundValid = false;

                    for (const plot of parsedPlots) {
                        if (plot.type === 'explicit' || plot.type === 'parametric' || plot.type === 'polar') {
                            const dataArray = Array.isArray(plot.data) ? plot.data : [];
                            for (const pt of dataArray) {
                                if (pt && pt.y !== null && !isNaN(pt.y) && isFinite(pt.y) &&
                                    pt.x !== null && !isNaN(pt.x) && isFinite(pt.x)) {
                                    
                                    let val = null;
                                    if (tracingVar === 'x') val = pt.x;
                                    else if (tracingVar === 'y') val = pt.y;

                                    if (val !== null) {
                                        if (val < minValid) minValid = val;
                                        if (val > maxValid) maxValid = val;
                                        foundValid = true;
                                    }
                                }
                            }
                        } else if (plot.type === 'vector') {
                            const pts = (plot.data && plot.data.points) || [];
                            for (const pt of pts) {
                                const val = tracingVar === 'x' ? pt.x : pt.y;
                                if (val < minValid) minValid = val;
                                if (val > maxValid) maxValid = val;
                                foundValid = true;
                            }
                        } else if (plot.type === 'implicit') {
                            const X = (plot.data && plot.data.X) || [];
                            const Y = (plot.data && plot.data.Y) || [];
                            const V = (plot.data && plot.data.V) || [];
                            for (let i = 0; i < X.length; i++) {
                                for (let j = 0; j < Y.length; j++) {
                                    if (V[i] && !isNaN(V[i][j]) && isFinite(V[i][j])) {
                                        const val = tracingVar === 'x' ? X[i] : Y[j];
                                        if (val < minValid) minValid = val;
                                        if (val > maxValid) maxValid = val;
                                        foundValid = true;
                                    }
                                }
                            }
                        }
                    }

                    if (foundValid && minValid < maxValid) {
                        traceMin = minValid;
                        traceMax = maxValid;
                    }
                }

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
                        xLim: customOptions.xlim,
                        yLim: customOptions.ylim,
                        parameterDomain,
                        fontFamily: config.style.fontFamily || 'sans-serif'
                    };

                    if (isTracingMode) {
                        opts.tracingVar = tracingVar;
                        opts.tracingLimit = traceMin + progress * (traceMax - traceMin);
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
                            parsed = parseSingleExpression(parts[0], Object.assign({}, opts, {
                                semanticMode: !!semantics,
                                semantics
                            }));
                        } catch (err) {
                            return { success: false, error: `Parsing error in expression: ${err.message}` };
                        }
                        type = parsed.type;
                        plotData = parsed.data;
                        latexText = parsed.latexText;
                        if (!isTracingMode) {
                            const val = opts.evalScope[animVar];
                            const formattedVar = formatVarToTex(animVar);
                            latexText += `\\quad (${formattedVar} = ${val.toFixed(2)})`;
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
                            const formattedVar = formatVarToTex(animVar);
                            latexText += `\\quad (${formattedVar} = ${val.toFixed(2)})`;
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
                try {
                    const videoBuf = await compileVideo(frameBuffers, DEFAULT_PLOT2D_ANIMATION_FPS);
                    return {
                        success: true,
                        data: videoBuf.toString('base64'),
                        mimeType: 'video/mp4',
                        filename: 'plot2d.mp4',
                        source: 'local-plot-2d-anim',
                        isAnimation: true
                    };
                } catch (ffmpegErr) {
                    console.warn('Failed to compile 2D animation with ffmpeg:', ffmpegErr.message);
                    const fallbackBuf = frameBuffers[frameBuffers.length - 1];
                    return {
                        success: true,
                        data: fallbackBuf.toString('base64'),
                        mimeType: 'image/jpeg',
                        filename: 'plot2d_fallback.jpg',
                        source: 'local-plot-2d-fallback'
                    };
                }

            } catch (err) {
                console.error('Error during 2D plot animation rendering:', err.message);
                return { success: false, error: err.message };
            } finally {
                if (shouldCloseAnimPage && animPage) {
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
                xLim: customOptions.xlim,
                yLim: customOptions.ylim,
                parameterDomain,
                fontFamily: config.style.fontFamily || 'sans-serif'
            };

            let type = '';
            let plotData = null;
            let latexText = '';

            if (parts.length === 1) {
                let parsed;
                try {
                    parsed = parseSingleExpression(parts[0], Object.assign({}, opts, {
                        semanticMode: !!semantics,
                        semantics
                    }));
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

async function renderOde(latexText, curves, customOptions = {}, renderPage = null) {
    const isInitialized = katexModule.isInitialized();
    const page = renderPage || katexModule.getPage();
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
