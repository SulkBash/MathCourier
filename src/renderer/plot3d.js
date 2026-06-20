const math = require('../math');
const config = require('../../config');
const katexModule = require('./katex');
const { splitByTopLevelCommas } = require('./plot');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ZERO_TOLERANCE = 1e-9;
const MAX_CONCURRENT_PLOT3D = Math.max(1, Number(config.bot?.plot3dMaxConcurrency) || 3);
const DEFAULT_ANIMATION_FRAMES = Math.max(6, Number(config.bot?.plot3dAnimationFrames) || 12);
const DEFAULT_ANIMATION_FPS = Math.max(4, Number(config.bot?.plot3dAnimationFps) || 10);
const DEFAULT_ANIMATION_BASE_ANGLE_DEGREES = Number(config.bot?.plot3dAnimationBaseAngleDegrees) || 45;
const DEFAULT_ANIMATION_SWING_DEGREES = Math.max(5, Math.min(44, Number(config.bot?.plot3dAnimationSwingDegrees) || 30));
const DEFAULT_ANIMATION_CAMERA_RADIUS = Math.max(0.8, Number(config.bot?.plot3dAnimationCameraRadius) || 1.6);
const DEFAULT_ANIMATION_CAMERA_HEIGHT = Math.max(0.4, Number(config.bot?.plot3dAnimationCameraHeight) || 1.1);

let activePlot3dJobs = 0;
const plot3dWaitQueue = [];

function createPlot3dRelease() {
    let released = false;

    return () => {
        if (released) {
            return;
        }
        released = true;

        const next = plot3dWaitQueue.shift();
        if (next) {
            next(createPlot3dRelease());
            return;
        }

        activePlot3dJobs = Math.max(0, activePlot3dJobs - 1);
    };
}

async function acquirePlot3dSlot() {
    if (activePlot3dJobs < MAX_CONCURRENT_PLOT3D) {
        activePlot3dJobs += 1;
        return createPlot3dRelease();
    }

    return new Promise((resolve) => {
        plot3dWaitQueue.push(resolve);
    });
}

function degreesToRadians(degrees) {
    return (degrees * Math.PI) / 180;
}

function buildCameraForAngle(theta) {
    return {
        eye: {
            x: DEFAULT_ANIMATION_CAMERA_RADIUS * Math.cos(theta),
            y: DEFAULT_ANIMATION_CAMERA_RADIUS * Math.sin(theta),
            z: DEFAULT_ANIMATION_CAMERA_HEIGHT
        },
        up: { x: 0, y: 0, z: 1 },
        center: { x: 0, y: 0, z: 0 }
    };
}

function buildDefaultCamera() {
    return buildCameraForAngle(degreesToRadians(DEFAULT_ANIMATION_BASE_ANGLE_DEGREES));
}

function buildSwingCamera(progress) {
    const baseTheta = degreesToRadians(DEFAULT_ANIMATION_BASE_ANGLE_DEGREES);
    const swingTheta = degreesToRadians(DEFAULT_ANIMATION_SWING_DEGREES);
    const theta = baseTheta + swingTheta * Math.sin((2 * Math.PI * progress) - (Math.PI / 2));
    return buildCameraForAngle(theta);
}

function buildOrbitCamera(progress) {
    const baseTheta = degreesToRadians(DEFAULT_ANIMATION_BASE_ANGLE_DEGREES);
    return buildCameraForAngle(baseTheta + (2 * Math.PI * progress));
}

function buildAnimationCamera(progress, mode = 'swing') {
    if (mode === 'orbit') {
        return buildOrbitCamera(progress);
    }

    return buildSwingCamera(progress);
}

// Coerce mathjs result to a plain number
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

// Preprocess expression to insert implicit multiplications for x/y
function preprocessExpr(expr) {
    if (!expr) return '';

    const symbols = new Set(['x', 'y', 'z']);
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
    const match = expr.match(/^([A-Za-z][A-Za-z0-9_]*)\(\s*x\s*,\s*y\s*,\s*z\s*\)\s*=\s*(.+)$/);
    if (!match) {
        return null;
    }

    const components = parseVectorTuple(match[2], 3);
    if (!components) {
        return null;
    }

    return {
        name: match[1],
        components
    };
}

function expressionUsesAnySymbol(expr, symbolNames) {
    try {
        const symbolSet = new Set(symbolNames);
        let found = false;
        math.parse(preprocessExpr(expr)).traverse((child) => {
            if (child && child.isSymbolNode && symbolSet.has(child.name)) {
                found = true;
            }
        });
        return found;
    } catch (err) {
        return false;
    }
}

function shouldTreatBareTupleAsVector(components, hasCustomYDomain, hasCustomZDomain) {
    if (hasCustomYDomain || hasCustomZDomain) {
        return true;
    }

    return components.some((component) => expressionUsesAnySymbol(component, ['x', 'y', 'z']));
}

function sampleVectorField3d(components, opts) {
    const [xExpr, yExpr, zExpr] = components;
    const xCompiled = math.compile(preprocessExpr(xExpr));
    const yCompiled = math.compile(preprocessExpr(yExpr));
    const zCompiled = math.compile(preprocessExpr(zExpr));

    const [xMin, xMax] = opts.xDomain;
    const [yMin, yMax] = opts.yDomain;
    const [zMin, zMax] = opts.zDomain;

    const steps = 5;
    const xStep = (xMax - xMin) / steps;
    const yStep = (yMax - yMin) / steps;
    const zStep = (zMax - zMin) / steps;

    const points = [];
    let maxMag = 0;

    for (let i = 0; i <= steps; i++) {
        const x = xMin + i * xStep;
        for (let j = 0; j <= steps; j++) {
            const y = yMin + j * yStep;
            for (let k = 0; k <= steps; k++) {
                const z = zMin + k * zStep;
                try {
                    const u = toReal(xCompiled.evaluate({ x, y, z }));
                    const v = toReal(yCompiled.evaluate({ x, y, z }));
                    const w = toReal(zCompiled.evaluate({ x, y, z }));
                    if (!isNaN(u) && isFinite(u) && !isNaN(v) && isFinite(v) && !isNaN(w) && isFinite(w)) {
                        const mag = Math.sqrt(u * u + v * v + w * w);
                        if (mag > ZERO_TOLERANCE) {
                            maxMag = Math.max(maxMag, mag);
                            points.push({ x, y, z, u, v, w, mag });
                        }
                    }
                } catch (err) { }
            }
        }
    }

    if (points.length === 0 || maxMag <= ZERO_TOLERANCE) {
        return null;
    }

    const minSpacing = Math.min(
        Math.abs(xStep) || Infinity,
        Math.abs(yStep) || Infinity,
        Math.abs(zStep) || Infinity
    );
    const safeSpacing = Number.isFinite(minSpacing) && minSpacing > ZERO_TOLERANCE ? minSpacing : 1;
    const scale = (safeSpacing * 0.75) / maxMag;

    return {
        x: points.map((point) => point.x),
        y: points.map((point) => point.y),
        z: points.map((point) => point.z),
        u: points.map((point) => point.u * scale),
        v: points.map((point) => point.v * scale),
        w: points.map((point) => point.w * scale)
    };
}

function nodeContainsSymbol(node, symbolName) {
    let found = false;
    node.traverse((child) => {
        if (child && child.isSymbolNode && child.name === symbolName) {
            found = true;
        }
    });
    return found;
}

function isZeroNode(node) {
    const simplified = math.simplify(node);
    if (simplified.toString() === '0') {
        return true;
    }

    if (nodeContainsSymbol(simplified, 'x') || nodeContainsSymbol(simplified, 'y') || nodeContainsSymbol(simplified, 'z')) {
        return false;
    }

    try {
        const value = toReal(simplified.compile().evaluate({ x: 1, y: 1, z: 1 }));
        return !isNaN(value) && isFinite(value) && Math.abs(value) < ZERO_TOLERANCE;
    } catch (err) {
        return false;
    }
}

function substituteSymbolWithZero(node, symbolName) {
    return node.transform((child) => {
        if (child && child.isSymbolNode && child.name === symbolName) {
            return math.parse('0');
        }
        return child;
    });
}

function buildExplicitSurfaceFromLinearZ(combinedExpr, opts) {
    const combinedNode = math.parse(combinedExpr);
    const zCoeffNode = math.simplify(math.derivative(combinedNode, 'z'));

    if (isZeroNode(zCoeffNode)) {
        return null;
    }

    const zSecondDerivative = math.simplify(math.derivative(zCoeffNode, 'z'));
    if (!isZeroNode(zSecondDerivative)) {
        return null;
    }

    const zFreeNode = math.simplify(substituteSymbolWithZero(combinedNode, 'z'));
    const zCoeffCompiled = zCoeffNode.compile();
    const zFreeCompiled = zFreeNode.compile();

    const xMin = opts.xDomain[0];
    const xMax = opts.xDomain[1];
    const yMin = opts.yDomain[0];
    const yMax = opts.yDomain[1];
    const gridSteps = 40;
    const xGrid = [];
    const yGrid = [];

    for (let i = 0; i <= gridSteps; i++) {
        xGrid.push(xMin + i * (xMax - xMin) / gridSteps);
    }
    for (let j = 0; j <= gridSteps; j++) {
        yGrid.push(yMin + j * (yMax - yMin) / gridSteps);
    }

    const zGrid = [];
    const allZ = [];

    for (let j = 0; j <= gridSteps; j++) {
        const row = [];
        const y = yGrid[j];
        for (let i = 0; i <= gridSteps; i++) {
            const x = xGrid[i];

            try {
                const zCoeff = toReal(zCoeffCompiled.evaluate({ x, y }));
                const zFree = toReal(zFreeCompiled.evaluate({ x, y }));

                if (!isNaN(zCoeff) && isFinite(zCoeff) && Math.abs(zCoeff) > ZERO_TOLERANCE && !isNaN(zFree) && isFinite(zFree)) {
                    const zValue = -zFree / zCoeff;
                    if (!isNaN(zValue) && isFinite(zValue)) {
                        row.push(zValue);
                        allZ.push(zValue);
                        continue;
                    }
                }
            } catch (err) { }

            row.push(null);
        }
        zGrid.push(row);
    }

    if (allZ.length === 0) {
        return null;
    }

    if (!opts.zDomain) {
        const zMin = Math.min(...allZ);
        const zMax = Math.max(...allZ);
        const margin = (zMax - zMin) * 0.1 || 0.5;
        opts.zDomain = [zMin - margin, zMax + margin];
    }

    let latexText = '';
    try {
        const explicitNode = math.simplify(`-(${zFreeNode.toString()}) / (${zCoeffNode.toString()})`);
        latexText = `z = ${explicitNode.toTex()}`;
    } catch (err) { }

    return {
        type: 'surface',
        plotData: { x: xGrid, y: yGrid, z: zGrid },
        latexText
    };
}

function buildTempVideoPath() {
    const suffix = `${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    return path.join(os.tmpdir(), `plot3d_rotation_${suffix}.mp4`);
}

// Compile in-memory JPEG frames into an H.264 MP4 using ffmpeg.
function compileVideo(frameBuffers, fps = DEFAULT_ANIMATION_FPS) {
    return new Promise((resolve, reject) => {
        const outputPath = buildTempVideoPath();
        const ffmpeg = spawn('ffmpeg', [
            '-y',
            '-loglevel', 'error',
            '-f', 'image2pipe',
            '-framerate', String(fps),
            '-vcodec', 'mjpeg',
            '-i', 'pipe:0',
            '-an',
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
            outputPath
        ]);

        let stderr = '';
        let settled = false;

        const cleanupOutput = () => {
            if (fs.existsSync(outputPath)) {
                try {
                    fs.unlinkSync(outputPath);
                } catch (err) { }
            }
        };

        const fail = (err) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanupOutput();
            reject(err);
        };

        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        ffmpeg.on('error', fail);
        ffmpeg.stdin.on('error', (err) => {
            if (err.code !== 'EPIPE') {
                fail(err);
            }
        });

        ffmpeg.on('close', (code) => {
            if (settled) {
                return;
            }

            if (code !== 0) {
                fail(new Error(`ffmpeg exited with code ${code}. Stderr: ${stderr || 'No stderr output.'}`));
                return;
            }

            try {
                const videoBuf = fs.readFileSync(outputPath);
                cleanupOutput();
                settled = true;
                resolve(videoBuf);
            } catch (err) {
                fail(err);
            }
        });

        for (const frameBuffer of frameBuffers) {
            ffmpeg.stdin.write(frameBuffer);
        }
        ffmpeg.stdin.end();
    });
}

async function renderPlot3d(rawExpr, customOptions = {}) {
    if (!katexModule.isInitialized()) {
        return { success: false, error: 'Local renderer is not initialized.' };
    }

    const releasePlot3dSlot = await acquirePlot3dSlot();
    let page = null;

    const expr = rawExpr.trim();
    const graphStyle = config.style.graph || {};
    const hasCustomXDomain = Array.isArray(customOptions.xDomain);
    const hasCustomYDomain = Array.isArray(customOptions.yDomain);
    const hasCustomZDomain = Array.isArray(customOptions.zDomain);
    const opts = {
        width: graphStyle.width || 600,
        height: graphStyle.height || 450,
        gridColor: graphStyle.gridColor || 'rgba(255, 255, 255, 0.08)',
        axisColor: graphStyle.axisColor || 'rgba(255, 255, 255, 0.3)',
        axisLabelColor: graphStyle.axisLabelColor || 'rgba(248, 250, 252, 0.8)',
        curveColors: graphStyle.curveColors || ['#06b6d4', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#84cc16'],
        lineWidth: graphStyle.lineWidth || 6,
        xDomain: customOptions.xDomain || graphStyle.defaultXDomain || [-10, 10],
        yDomain: customOptions.yDomain || graphStyle.defaultYDomain || [-10, 10],
        zDomain: customOptions.zDomain || null,
        isAnimated: customOptions.isAnimated || false,
        animationMode: customOptions.animationMode || 'swing',
        camera: buildDefaultCamera()
    };

    try {
        page = await katexModule.createRenderPage();

        let type = '';
        let plotData = null;
        let latexText = '';

        const namedVectorField = parseNamedVectorField(expr);
        const bareTuple = namedVectorField ? null : parseVectorTuple(expr, 3);
        const isBareVectorField = bareTuple && shouldTreatBareTupleAsVector(bareTuple, hasCustomYDomain, hasCustomZDomain);
        const isParametric = bareTuple && !isBareVectorField && !namedVectorField;

        if (namedVectorField || isBareVectorField) {
            type = 'vector3d';
            const fieldName = namedVectorField ? namedVectorField.name : 'F';
            const components = namedVectorField ? namedVectorField.components : bareTuple;

            if (!opts.zDomain) {
                opts.zDomain = [...opts.xDomain];
            }

            plotData = sampleVectorField3d(components, opts);
            if (!plotData) {
                return { success: false, error: 'No valid real vectors were computed for this field. Check if the field is defined on the given domains.' };
            }

            try {
                const [uExpr, vExpr, wExpr] = components;
                const texU = math.parse(uExpr).toTex();
                const texV = math.parse(vExpr).toTex();
                const texW = math.parse(wExpr).toTex();
                latexText = `\\vec{${fieldName}}(x,y,z) = \\begin{pmatrix} ${texU} \\\\ ${texV} \\\\ ${texW} \\end{pmatrix}`;
            } catch (e) {
                latexText = `\\vec{${fieldName}}(x,y,z) = \\left( ${components.join(', ')} \\right)`;
            }
        } else if (isParametric) {
            type = 'curve';
            const [xExpr, yExpr, zExpr] = bareTuple.map(e => e.trim());
            const xCompiled = math.compile(preprocessExpr(xExpr));
            const yCompiled = math.compile(preprocessExpr(yExpr));
            const zCompiled = math.compile(preprocessExpr(zExpr));

            // Default parametric range [0, 2*pi]
            const tMin = hasCustomXDomain ? opts.xDomain[0] : 0;
            const tMax = hasCustomXDomain ? opts.xDomain[1] : 2 * Math.PI;
            opts.xDomain = [tMin, tMax]; // Override for graph setup range mapping (internally handled)

            const steps = 250;
            const tStep = (tMax - tMin) / steps;

            const xVals = [];
            const yVals = [];
            const zVals = [];

            for (let i = 0; i <= steps; i++) {
                const t = tMin + i * tStep;
                try {
                    const x = toReal(xCompiled.evaluate({ t }));
                    const y = toReal(yCompiled.evaluate({ t }));
                    const z = toReal(zCompiled.evaluate({ t }));

                    if (!isNaN(x) && isFinite(x) && !isNaN(y) && isFinite(y) && !isNaN(z) && isFinite(z)) {
                        xVals.push(x);
                        yVals.push(y);
                        zVals.push(z);
                    }
                } catch (err) { }
            }

            plotData = { x: xVals, y: yVals, z: zVals };

            if (xVals.length === 0) {
                return { success: false, error: 'No valid real numbers were computed for this curve. Check if the function is defined on the given domain.' };
            }

            // Determine bounds dynamically for curve scene
            const getBounds = (arr, fallback) => {
                if (arr.length === 0) return fallback;
                const min = Math.min(...arr);
                const max = Math.max(...arr);
                const margin = (max - min) * 0.1 || 0.5;
                return [min - margin, max + margin];
            };
            opts.xDomain = getBounds(xVals, [-5, 5]);
            opts.yDomain = getBounds(yVals, [-5, 5]);
            opts.zDomain = opts.zDomain || getBounds(zVals, [-5, 5]);

            try {
                const texX = math.parse(xExpr).toTex();
                const texY = math.parse(yExpr).toTex();
                const texZ = math.parse(zExpr).toTex();
                latexText = `\\vec{r}(t) = \\begin{pmatrix} ${texX} \\\\ ${texY} \\\\ ${texZ} \\end{pmatrix}`;
            } catch (e) {
                latexText = `\\vec{r}(t) = \\left( ${xExpr}, ${yExpr}, ${zExpr} \\right)`;
            }

        } else {
            // Check if it's an implicit equation
            let isImplicit = false;
            let lhs = '';
            let rhs = '';

            if (expr.includes('=')) {
                const eqIdx = expr.indexOf('=');
                lhs = expr.substring(0, eqIdx).trim();
                rhs = expr.substring(eqIdx + 1).trim();

                if (lhs.toLowerCase() !== 'z') {
                    isImplicit = true;
                }
            } else {
                rhs = expr;
                lhs = 'z';
            }

            if (isImplicit) {
                const combined = `(${preprocessExpr(lhs)}) - (${preprocessExpr(rhs)})`;
                const projectedSurface = buildExplicitSurfaceFromLinearZ(combined, opts);

                if (projectedSurface) {
                    type = projectedSurface.type;
                    plotData = projectedSurface.plotData;
                    try {
                        latexText = projectedSurface.latexText || `${math.parse(lhs).toTex()} = ${math.parse(rhs).toTex()}`;
                    } catch (e) {
                        latexText = projectedSurface.latexText || `${lhs} = ${rhs}`;
                    }
                } else {
                    type = 'implicit';
                    const compiled = math.compile(combined);

                    const xMin = opts.xDomain[0];
                    const xMax = opts.xDomain[1];
                    const yMin = opts.yDomain[0];
                    const yMax = opts.yDomain[1];

                    const zMin = (opts.zDomain && opts.zDomain[0] !== undefined) ? opts.zDomain[0] : xMin;
                    const zMax = (opts.zDomain && opts.zDomain[1] !== undefined) ? opts.zDomain[1] : xMax;
                    opts.zDomain = [zMin, zMax];

                    // Coarse pass to detect active bounding box containing the isosurface zero-crossings
                    const coarseSteps = 30;
                    const coarseV = [];
                    for (let i = 0; i <= coarseSteps; i++) {
                        const x = xMin + i * (xMax - xMin) / coarseSteps;
                        const row = [];
                        for (let j = 0; j <= coarseSteps; j++) {
                            const y = yMin + j * (yMax - yMin) / coarseSteps;
                            const col = [];
                            for (let k = 0; k <= coarseSteps; k++) {
                                const z = zMin + k * (zMax - zMin) / coarseSteps;
                                let val = NaN;
                                try {
                                    val = toReal(compiled.evaluate({ x, y, z }));
                                } catch (e) { }
                                col.push(!isNaN(val) && isFinite(val) ? val : NaN);
                            }
                            row.push(col);
                        }
                        coarseV.push(row);
                    }

                    const activeX = [];
                    const activeY = [];
                    const activeZ = [];

                    for (let i = 0; i <= coarseSteps; i++) {
                        const x = xMin + i * (xMax - xMin) / coarseSteps;
                        for (let j = 0; j <= coarseSteps; j++) {
                            const y = yMin + j * (yMax - yMin) / coarseSteps;
                            for (let k = 0; k <= coarseSteps; k++) {
                                const z = zMin + k * (zMax - zMin) / coarseSteps;
                                const val = coarseV[i][j][k];
                                if (isNaN(val)) continue;

                                let hasCrossing = false;
                                const neighbors = [
                                    [i + 1, j, k],
                                    [i, j + 1, k],
                                    [i, j, k + 1],
                                    [i - 1, j, k],
                                    [i, j - 1, k],
                                    [i, j, k - 1]
                                ];

                                for (const [ni, nj, nk] of neighbors) {
                                    if (ni >= 0 && ni <= coarseSteps &&
                                        nj >= 0 && nj <= coarseSteps &&
                                        nk >= 0 && nk <= coarseSteps) {
                                        const nVal = coarseV[ni][nj][nk];
                                        if (!isNaN(nVal) && val * nVal <= 0) {
                                            hasCrossing = true;
                                            break;
                                        }
                                    }
                                }

                                if (hasCrossing) {
                                    activeX.push(x);
                                    activeY.push(y);
                                    activeZ.push(z);
                                }
                            }
                        }
                    }

                    let evalXMin = xMin;
                    let evalXMax = xMax;
                    let evalYMin = yMin;
                    let evalYMax = yMax;
                    let evalZMin = zMin;
                    let evalZMax = zMax;

                    if (activeX.length > 0) {
                        const rawMinX = Math.min(...activeX);
                        const rawMaxX = Math.max(...activeX);
                        const rawMinY = Math.min(...activeY);
                        const rawMaxY = Math.max(...activeY);
                        const rawMinZ = Math.min(...activeZ);
                        const rawMaxZ = Math.max(...activeZ);

                        const padX = (rawMaxX - rawMinX) * 0.15 || 0.2;
                        const padY = (rawMaxY - rawMinY) * 0.15 || 0.2;
                        const padZ = (rawMaxZ - rawMinZ) * 0.15 || 0.2;

                        evalXMin = Math.max(xMin, rawMinX - padX);
                        evalXMax = Math.min(xMax, rawMaxX + padX);
                        evalYMin = Math.max(yMin, rawMinY - padY);
                        evalYMax = Math.min(yMax, rawMaxY + padY);
                        evalZMin = Math.max(zMin, rawMinZ - padZ);
                        evalZMax = Math.min(zMax, rawMaxZ + padZ);

                        if (evalXMax - evalXMin < 0.5) {
                            const cx = (evalXMin + evalXMax) / 2;
                            evalXMin = Math.max(xMin, cx - 0.25);
                            evalXMax = Math.min(xMax, cx + 0.25);
                        }
                        if (evalYMax - evalYMin < 0.5) {
                            const cy = (evalYMin + evalYMax) / 2;
                            evalYMin = Math.max(yMin, cy - 0.25);
                            evalYMax = Math.min(yMax, cy + 0.25);
                        }
                        if (evalZMax - evalZMin < 0.5) {
                            const cz = (evalZMin + evalZMax) / 2;
                            evalZMin = Math.max(zMin, cz - 0.25);
                            evalZMax = Math.min(zMax, cz + 0.25);
                        }

                        if (!hasCustomXDomain) {
                            opts.xDomain = [evalXMin, evalXMax];
                        }
                        if (!hasCustomYDomain) {
                            opts.yDomain = [evalYMin, evalYMax];
                        }
                        if (!hasCustomZDomain) {
                            opts.zDomain = [evalZMin, evalZMax];
                        }
                    }

                    const gridSteps = 35;
                    const xVals = [];
                    const yVals = [];
                    const zVals = [];
                    const valueVals = [];

                    for (let i = 0; i <= gridSteps; i++) {
                        const x = evalXMin + i * (evalXMax - evalXMin) / gridSteps;
                        for (let j = 0; j <= gridSteps; j++) {
                            const y = evalYMin + j * (evalYMax - evalYMin) / gridSteps;
                            for (let k = 0; k <= gridSteps; k++) {
                                const z = evalZMin + k * (evalZMax - evalZMin) / gridSteps;
                                xVals.push(x);
                                yVals.push(y);
                                zVals.push(z);
                                try {
                                    const val = toReal(compiled.evaluate({ x, y, z }));
                                    valueVals.push(!isNaN(val) && isFinite(val) ? val : NaN);
                                } catch (e) {
                                    valueVals.push(NaN);
                                }
                            }
                        }
                    }

                    plotData = { x: xVals, y: yVals, z: zVals, value: valueVals };

                    try {
                        latexText = `${math.parse(lhs).toTex()} = ${math.parse(rhs).toTex()}`;
                    } catch (e) {
                        latexText = `${lhs} = ${rhs}`;
                    }
                }
            } else {
                // Explicit surface z = f(x, y)
                type = 'surface';
                const compiled = math.compile(preprocessExpr(rhs));
                const xMin = opts.xDomain[0];
                const xMax = opts.xDomain[1];
                const yMin = opts.yDomain[0];
                const yMax = opts.yDomain[1];

                const gridSteps = 40;
                const xGrid = [];
                const yGrid = [];

                for (let i = 0; i <= gridSteps; i++) {
                    xGrid.push(xMin + i * (xMax - xMin) / gridSteps);
                }
                for (let j = 0; j <= gridSteps; j++) {
                    yGrid.push(yMin + j * (yMax - yMin) / gridSteps);
                }

                const zGrid = [];
                let allZ = [];

                for (let j = 0; j <= gridSteps; j++) {
                    const row = [];
                    const yVal = yGrid[j];
                    for (let i = 0; i <= gridSteps; i++) {
                        const xVal = xGrid[i];
                        try {
                            const zVal = toReal(compiled.evaluate({ x: xVal, y: yVal }));
                            const ok = !isNaN(zVal) && isFinite(zVal);
                            row.push(ok ? zVal : null);
                            if (ok) allZ.push(zVal);
                        } catch (e) {
                            row.push(null);
                        }
                    }
                    zGrid.push(row);
                }

                plotData = { x: xGrid, y: yGrid, z: zGrid };

                if (allZ.length === 0) {
                    return { success: false, error: 'No valid real numbers were computed for this surface. Check if the function is defined on the given domains.' };
                }

                if (!opts.zDomain) {
                    if (allZ.length > 0) {
                        const zMin = Math.min(...allZ);
                        const zMax = Math.max(...allZ);
                        const margin = (zMax - zMin) * 0.1 || 0.5;
                        opts.zDomain = [zMin - margin, zMax + margin];
                    } else {
                        opts.zDomain = [-5, 5];
                    }
                }

                try {
                    latexText = `z = ${math.parse(rhs).toTex()}`;
                } catch (e) {
                    latexText = `z = ${rhs}`;
                }
            }
        }

        // Render Plotly in Puppeteer context
        const renderResult = await page.evaluate((lat, t, pData, opt) => {
            return window.renderGraph3d(lat, t, pData, opt);
        }, latexText, type, plotData, opts);

        if (!renderResult.success) {
            return { success: false, error: renderResult.error };
        }

        const card = await page.$('#card');
        if (!card) {
            return { success: false, error: 'Card element not found in DOM.' };
        }

        if (opts.isAnimated) {
            const totalFrames = DEFAULT_ANIMATION_FRAMES;
            const frameBuffers = [];

            for (let f = 0; f < totalFrames; f++) {
                const progress = opts.animationMode === 'orbit'
                    ? f / totalFrames
                    : (totalFrames === 1 ? 0 : f / (totalFrames - 1));
                const camera = buildAnimationCamera(progress, opts.animationMode);

                await page.evaluate((nextCamera) => {
                    return Plotly.relayout('plotly-graph', { 'scene.camera': nextCamera }).then(() => {
                        return new Promise((resolve) => {
                            requestAnimationFrame(() => requestAnimationFrame(resolve));
                        });
                    });
                }, camera);

                const buf = await card.screenshot({ type: 'jpeg', quality: 85 });
                frameBuffers.push(buf);
            }

            try {
                const videoBuf = await compileVideo(frameBuffers, DEFAULT_ANIMATION_FPS);

                return {
                    success: true,
                    data: videoBuf.toString('base64'),
                    mimeType: 'video/mp4',
                    filename: 'plot3d.mp4',
                    source: 'local-plot3d-anim',
                    isAnimation: true
                };
            } catch (ffmpegErr) {
                console.warn('Failed to compile video with ffmpeg:', ffmpegErr.message);

                // Graceful fallback: return the first frame as static JPEG
                const fallbackBuf = frameBuffers[0] || await card.screenshot({ type: 'jpeg', quality: 85 });

                return {
                    success: true,
                    data: fallbackBuf.toString('base64'),
                    mimeType: 'image/jpeg',
                    filename: 'plot3d_fallback.jpg',
                    source: 'local-plot3d-fallback'
                };
            }
        } else {
            // Render static screenshot
            const buf = await card.screenshot({ type: 'png', omitBackground: true });

            return {
                success: true,
                data: buf.toString('base64'),
                mimeType: 'image/png',
                filename: 'plot3d.png',
                source: 'local-plot3d-static'
            };
        }

    } catch (err) {
        console.error('Error during 3D plotting:', err);
        return { success: false, error: err.message };
    } finally {
        if (page) {
            try {
                await page.close();
            } catch (closeErr) { }
        }

        releasePlot3dSlot();
    }
}

module.exports = {
    renderPlot3d
};
