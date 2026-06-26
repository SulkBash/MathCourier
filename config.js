const path = require('path');

module.exports = {
    style: {
        backgroundColor: '#0f172a',
        textColor: '#f8fafc',
        fontSize: '24px',
        fontFamily: "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        padding: '28px 32px',
        borderRadius: '16px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3)',

        watermark: {
            text: 'MathCourier',
            color: 'rgba(248, 250, 252, 0.4)',
            fontSize: '11px',
            fontFamily: 'monospace'
        },

        graph: {
            width: 600,
            height: 600,
            gridColor: 'rgba(255, 255, 255, 0.06)',
            axisColor: 'rgba(255, 255, 255, 0.3)',
            axisLabelColor: 'rgba(248, 250, 252, 0.5)',
            curveColors: ['#06b6d4', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#84cc16'],
            glowColor: 'rgba(6, 182, 212, 0.4)',
            glowBlur: 10,
            lineWidth: 3.5,
            defaultXDomain: [-10, 10],
            defaultYDomain: [-10, 10],
            streamlineConeColor: '#ffd700'
        }
    },

    bot: {
        name: 'MathCourier',
        autoRenderBlock: true,
        errorPrefix: '*MathCourier Error:* ',
        useFallback: true,
        fallbackEngine: 'codecogs',
        renderMaxConcurrency: 8,
        renderMaxQueue: 128,
        plot3dMaxConcurrency: 3,
        plot2dAnimationFrames: 20,
        plot2dAnimationFps: 10,
        plot3dAnimationFrames: 24,
        plot3dAnimationFps: 8,
        plot3dAnimationBaseAngleDegrees: 45,
        plot3dAnimationSwingDegrees: 30,
        plot3dAnimationCameraRadius: 1.85,
        plot3dAnimationCameraHeight: 1.1,
        plot3dCameraCenterZ: -0.12,
        plot3dImplicitCoarseSteps: 40,
        plot3dImplicitGridSteps: 64,
        plot3dImplicitPaddingRatio: 0.15
    },

    runtime: {
        pythonBin: process.env.PYTHON_BIN || null,
        ffmpegBin: process.env.FFMPEG_BIN || null,
        browserExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_BIN || null,
        botName: process.env.BOT_NAME || null,
        botIdentityPath: process.env.BOT_IDENTITY_PATH || null,
        whatsappAuthPath: process.env.WWEBJS_AUTH_PATH || '.wwebjs_auth',
        whatsappCachePath: process.env.WWEBJS_CACHE_PATH || '.wwebjs_cache',
        rendererCachePath: process.env.RENDERER_CACHE_PATH || path.join('runtime_cache', 'renderer'),
        whatsappClientId: process.env.WWEBJS_CLIENT_ID || null,
        startupHealthSummary: true
    },

    puppeteer: {
        launchArgs: {
            headless: 'new',
            args: [
                '--enable-webgl',
                '--use-gl=angle',
                '--disable-dev-shm-usage',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding'
            ]
        }
    }
};
