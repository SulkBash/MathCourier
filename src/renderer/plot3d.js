const math = require('../math');
const config = require('../../config');
const katexModule = require('./katex');
const { splitByTopLevelCommas } = require('./plot');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ZERO_TOLERANCE = 1e-9;

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
    return expr
        .replace(/([xXyYzZ])\s*([xXyYzZ])/g, '$1*$2')
        .replace(/([xXyYzZ])\s*([xXyYzZ])/g, '$1*$2')
        .replace(/([xXyYzZ])\s*\(/g, '$1*(');
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
            } catch (err) {}

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
    } catch (err) {}

    return {
        type: 'surface',
        plotData: { x: xGrid, y: yGrid, z: zGrid },
        latexText
    };
}

// Compile frame sequence into an H.264 MP4 using ffmpeg
function compileVideo(framesPattern, outputPath, fps = 15) {
    return new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
            '-y',
            '-framerate', String(fps),
            '-i', framesPattern,
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
            outputPath
        ]);

        let stderr = '';
        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        ffmpeg.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`ffmpeg exited with code ${code}. Stderr: ${stderr}`));
            }
        });
    });
}

async function renderPlot3d(rawExpr, customOptions = {}) {
    const isInitialized = katexModule.isInitialized();
    const page = katexModule.getPage();
    if (!isInitialized || !page) {
        return { success: false, error: 'Local renderer is not initialized.' };
    }

    const expr = rawExpr.trim();
    const graphStyle = config.style.graph || {};
    const hasCustomXDomain = Array.isArray(customOptions.xDomain);
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
        isAnimated: customOptions.isAnimated || false
    };

    try {
        let type = '';
        let plotData = null;
        let latexText = '';

        // Check if expression is a 3D parametric curve (x(t), y(t), z(t))
        let isParametric = false;
        let parametricExprs = null;
        if (expr.startsWith('(') && expr.endsWith(')')) {
            const inner = expr.slice(1, -1).trim();
            const components = splitByTopLevelCommas(inner);
            if (components.length === 3) {
                isParametric = true;
                parametricExprs = components;
            }
        }

        if (isParametric) {
            type = 'curve';
            const [xExpr, yExpr, zExpr] = parametricExprs.map(e => e.trim());
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
                } catch (err) {}
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

                    const gridSteps = 30;
                    const xVals = [];
                    const yVals = [];
                    const zVals = [];
                    const valueVals = [];

                    for (let i = 0; i <= gridSteps; i++) {
                        const x = xMin + i * (xMax - xMin) / gridSteps;
                        for (let j = 0; j <= gridSteps; j++) {
                            const y = yMin + j * (yMax - yMin) / gridSteps;
                            for (let k = 0; k <= gridSteps; k++) {
                                const z = zMin + k * (zMax - zMin) / gridSteps;
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

        // Clean up Plotly helper from DOM after completion
        const cleanupPlotly = async () => {
            await page.evaluate(() => {
                const plotlyGraph = document.getElementById('plotly-graph');
                if (plotlyGraph) plotlyGraph.remove();
            });
        };

        if (opts.isAnimated) {
            // Build orbit camera sequence
            const tempDirName = `plot3d_temp_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
            const tempDirPath = path.join(__dirname, '..', '..', tempDirName);
            fs.mkdirSync(tempDirPath, { recursive: true });

            const originalViewport = page.viewport();
            const box = await card.boundingBox();
            if (box) {
                await page.setViewport({
                    width: Math.ceil(box.width),
                    height: Math.ceil(box.height),
                    deviceScaleFactor: 1
                });
            }

            const resetViewport = async () => {
                if (originalViewport) {
                    await page.setViewport(originalViewport);
                }
            };

            const totalFrames = 18;
            const R = 1.6;

            for (let f = 0; f < totalFrames; f++) {
                const theta = (2 * Math.PI * f) / totalFrames;
                const eye = {
                    x: R * Math.cos(theta),
                    y: R * Math.sin(theta),
                    z: 1.1
                };

                await page.evaluate((e) => {
                    return Plotly.relayout('plotly-graph', { 'scene.camera.eye': e });
                }, eye);

                const framePath = path.join(tempDirPath, `frame_${String(f).padStart(3, '0')}.jpg`);
                const buf = await page.screenshot({ type: 'jpeg', quality: 90 });
                fs.writeFileSync(framePath, buf);
            }

            const mp4Path = path.join(tempDirPath, 'rotation.mp4');

            try {
                await compileVideo(path.join(tempDirPath, 'frame_%03d.jpg'), mp4Path, 12);
                const videoBuf = fs.readFileSync(mp4Path);
                
                // Cleanup temp folder & reset page state
                fs.rmSync(tempDirPath, { recursive: true, force: true });
                await cleanupPlotly();
                await resetViewport();

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
                const firstFramePath = path.join(tempDirPath, 'frame_000.jpg');
                let fallbackBuf = null;
                if (fs.existsSync(firstFramePath)) {
                    fallbackBuf = fs.readFileSync(firstFramePath);
                } else {
                    fallbackBuf = await page.screenshot({ type: 'jpeg', quality: 90 });
                }

                // Cleanup temp folder & reset page state
                fs.rmSync(tempDirPath, { recursive: true, force: true });
                await cleanupPlotly();
                await resetViewport();

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
            await cleanupPlotly();

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
    }
}

module.exports = {
    renderPlot3d
};
