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
            text: 'LaTeX Render Bot',
            color: 'rgba(248, 250, 252, 0.4)',
            fontSize: '11px',
            fontFamily: "monospace"
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
            defaultYDomain: [-10, 10]
        }
    },

    bot: {
        name: 'LaTeX Bot',
        autoRenderBlock: true,
        errorPrefix: '⚠️ *LaTeX Error:* ',
        useFallback: true,
        fallbackEngine: 'codecogs',
        plot3dMaxConcurrency: 3,
        plot3dAnimationFrames: 24,
        plot3dAnimationFps: 8,
        plot3dAnimationBaseAngleDegrees: 45,
        plot3dAnimationSwingDegrees: 30,
        plot3dAnimationCameraRadius: 1.6,
        plot3dAnimationCameraHeight: 1.1
    },

    puppeteer: {
        launchArgs: {
            headless: 'new',
            args: [
                '--enable-webgl',
                '--use-gl=angle',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding'
            ]
        }
    }
};
