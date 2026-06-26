const katexModule = require('./katex');
const { renderPlot3d, compileVideo } = require('./plot3d');
const config = require('../../config');

async function renderPde(pdeRes, customOptions = {}, renderPage = null) {
    if (!pdeRes.success) {
        return { success: false, error: pdeRes.error };
    }

    const graphStyle = config.style.graph || {};
    const uFlat = pdeRes.u.flat();
    const uMin = Math.min(...uFlat);
    const uMax = Math.max(...uFlat);
    const yRange = uMax - uMin;
    const yPad = Math.max(yRange * 0.15, 1.0);
    const yDomain = [uMin - yPad, uMax + yPad];

    const is2d = customOptions.is2d || false;
    const isAnimated = customOptions.isAnimated || false;

    if (is2d) {
        if (isAnimated) {
            // Render 2D time-evolution animation
            if (!katexModule.isInitialized()) {
                return { success: false, error: 'Local renderer is not initialized.' };
            }

            let page = renderPage;
            let shouldClosePage = false;
            try {
                if (!page) {
                    page = await katexModule.createRenderPage();
                    shouldClosePage = true;
                }
                const totalFrames = 25; // 25 frames is standard and fast
                const frameBuffers = [];
                
                const tLen = pdeRes.t.length;
                const xLen = pdeRes.x.length;

                for (let f = 0; f < totalFrames; f++) {
                    const progress = f / (totalFrames - 1);
                    const tIdx = Math.round(progress * (tLen - 1));
                    const tVal = pdeRes.t[tIdx];

                    // Prepare curve points for this frame
                    const curveData = pdeRes.x.map((xv, idx) => ({
                        x: xv,
                        y: pdeRes.u[tIdx][idx]
                    }));

                    const frameLatex = `${pdeRes.pde_latex} \\\\ \\text{Time } t = ${tVal.toFixed(3)}`;

                    const renderResult = await page.evaluate((lat, data, opts) => {
                        return window.renderGraph(lat, 'explicit', data, opts);
                    }, frameLatex, curveData, {
                        width: graphStyle.width || 600,
                        height: graphStyle.height || 450,
                        gridColor: graphStyle.gridColor || 'rgba(255, 255, 255, 0.06)',
                        axisColor: graphStyle.axisColor || 'rgba(255, 255, 255, 0.3)',
                        axisLabelColor: graphStyle.axisLabelColor || 'rgba(248, 250, 252, 0.5)',
                        curveColors: graphStyle.curveColors || ['#06b6d4', '#8b5cf6'],
                        lineWidth: graphStyle.lineWidth || 3.5,
                        glowColor: graphStyle.glowColor || 'rgba(6, 182, 212, 0.4)',
                        glowBlur: graphStyle.glowBlur || 10,
                        xDomain: pdeRes.xDomain,
                        yDomain: yDomain
                    });

                    if (!renderResult.success) {
                        return { success: false, error: renderResult.error };
                    }

                    const card = await page.$('#card');
                    if (!card) {
                        return { success: false, error: 'Card element not found in DOM.' };
                    }

                    const buf = await card.screenshot({ type: 'jpeg', quality: 85 });
                    frameBuffers.push(buf);
                }

                const videoBuf = await compileVideo(frameBuffers, 8); // 8 FPS for smooth slow evolution
                return {
                    success: true,
                    data: videoBuf.toString('base64'),
                    mimeType: 'video/mp4',
                    filename: 'pde_2d_evolution.mp4',
                    source: 'local-pde-2d-anim',
                    isAnimation: true
                };

            } catch (err) {
                console.error('Error rendering 2D PDE animation:', err);
                return { success: false, error: err.message };
            } finally {
                if (shouldClosePage && page) {
                    try { await page.close(); } catch (_) {}
                }
            }
        } else {
            // Render static 2D plot with overlaid time-slices
            const numSlices = 5;
            const plots = [];
            const tLen = pdeRes.t.length;
            
            for (let i = 0; i < numSlices; i++) {
                const progress = i / (numSlices - 1);
                const tIdx = Math.round(progress * (tLen - 1));
                const tVal = pdeRes.t[tIdx];
                
                const sliceData = pdeRes.x.map((xv, idx) => ({
                    x: xv,
                    y: pdeRes.u[tIdx][idx]
                }));
                
                plots.push({
                    type: 'explicit',
                    label: `t = ${tVal.toFixed(2)}`,
                    data: sliceData
                });
            }

            if (!katexModule.isInitialized()) {
                return { success: false, error: 'Local renderer is not initialized.' };
            }

            let page = renderPage;
            let shouldClosePage = false;
            try {
                if (!page) {
                    page = await katexModule.createRenderPage();
                    shouldClosePage = true;
                }
                
                const renderResult = await page.evaluate((lat, data, opts) => {
                    return window.renderGraph(lat, 'multi', data, opts);
                }, pdeRes.pde_latex, plots, {
                    width: graphStyle.width || 600,
                    height: graphStyle.height || 450,
                    gridColor: graphStyle.gridColor || 'rgba(255, 255, 255, 0.06)',
                    axisColor: graphStyle.axisColor || 'rgba(255, 255, 255, 0.3)',
                    axisLabelColor: graphStyle.axisLabelColor || 'rgba(248, 250, 252, 0.5)',
                    curveColors: graphStyle.curveColors || ['#06b6d4', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#84cc16'],
                    lineWidth: graphStyle.lineWidth || 3.5,
                    glowColor: graphStyle.glowColor || 'rgba(6, 182, 212, 0.4)',
                    glowBlur: graphStyle.glowBlur || 10,
                    xDomain: pdeRes.xDomain,
                    yDomain: yDomain
                });

                if (!renderResult.success) {
                    return { success: false, error: renderResult.error };
                }

                const card = await page.$('#card');
                if (!card) {
                    return { success: false, error: 'Card element not found in DOM.' };
                }

                const buf = await card.screenshot({ type: 'png', omitBackground: true });
                return {
                    success: true,
                    data: buf.toString('base64'),
                    mimeType: 'image/png',
                    filename: 'pde_2d_slices.png',
                    source: 'local-pde-2d-static'
                };

            } catch (err) {
                console.error('Error rendering static 2D PDE:', err);
                return { success: false, error: err.message };
            } finally {
                if (shouldClosePage && page) {
                    try { await page.close(); } catch (_) {}
                }
            }
        }
    } else {
        // Render 3D surface plot using Plotly
        const pdeData = {
            x: pdeRes.x,
            y: pdeRes.t,
            z: pdeRes.u
        };

        const zDomain = [uMin - yPad * 0.5, uMax + yPad * 0.5];

        // Route to the existing renderPlot3d function with pre-calculated data
        return await renderPlot3d("", {
            pdeData,
            xDomain: pdeRes.xDomain,
            yDomain: pdeRes.tDomain,
            zDomain,
            latexText: pdeRes.pde_latex,
            isAnimated: customOptions.isAnimated,
            animationMode: customOptions.animationMode,
            animationAxis: customOptions.animationAxis,
            animationAngle: customOptions.animationAngle
        });
    }
}

module.exports = {
    renderPde
};
