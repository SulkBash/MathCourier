// Recreate the README gallery from the same command handlers used by the bot.
// Requires Python/Chromium, ffmpeg for the GIF, and QuickLaTeX for diagrams.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const config = require('../config');
const renderer = require('../src/renderer');
const katex = require('../src/renderer/katex');
const plot = require('../src/commands/plot');
const solve = require('../src/commands/solve');
const latex = require('../src/commands/latex');
const { getFfmpegCommand } = require('../src/runtime');

const outputDir = path.join(__dirname, '..', 'assets', 'readme');

const examples = [
    {
        file: 'surface-orbit.gif',
        handler: plot,
        command: 'z = sin(x)*cos(y) view:3d camera:z360 x:[-3,3] y:[-3,3]',
        animated: true
    },
    {
        file: 'polar-rose.png',
        handler: plot,
        command: 'r = 2 + cos(5*theta) kind:polar theta:[0,2*pi] x:[-3.5,3.5] y:[-3.5,3.5]'
    },
    {
        file: 'vector-flow.png',
        handler: plot,
        command: 'F(x,y,z) = (-y,x,z/2) view:3d kind:vector vars:{x,y,z} x:[-4,4] y:[-4,4] z:[-4,4]'
    },
    {
        file: 'chemical-benzoic-acid.png',
        handler: latex,
        command: String.raw`\scalebox{2.0}{\chemfig{HO-[:90]C(=[0]O)-[:90]*6(-=-=-=)}}`
    },
    {
        file: 'heat-equation.png',
        handler: solve,
        command: 'du/dt = 0.5*d2u/dx2 ic:{u(x,0)=sin(x)} bc:{u(0,t)=0; u(pi,t)=0} x:[0,pi] t:[0,2]'
    },
    {
        file: 'circuit-lc-filter.png',
        handler: latex,
        command: String.raw`\begin{tikzpicture}[scale=1.5,transform shape]\draw (0,0) to[sV,l=$v_{in}$] (0,3) to[R,l=$R$] (3,3) to[L,l=$L$] (6,3) to[C,l=$C_2$] (6,0) -- (0,0);\draw (3,3) node[circ]{} to[C,l=$C_1$] (3,0) node[circ]{};\end{tikzpicture}`
    },
    {
        file: 'schrodinger-equation.png',
        handler: latex,
        command: 'i\\hbar\\frac{\\partial\\Psi}{\\partial t}=\\left[-\\frac{\\hbar^2}{2m}\\nabla^2+V\\right]\\Psi'
    }
];

function makeGif(video) {
    const filters = '[0:v]fps=8,scale=640:-1:flags=lanczos,split[a][b];' +
        '[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle';
    const result = spawnSync(getFfmpegCommand(), [
        '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-filter_complex', filters,
        '-loop', '0', '-f', 'gif', 'pipe:1'
    ], { input: video, maxBuffer: 25 * 1024 * 1024, timeout: 120000 });
    if (result.error || result.status !== 0) {
        throw new Error(`Could not convert the animation to GIF: ${result.error?.message || String(result.stderr)}`);
    }
    return result.stdout;
}

async function main() {
    const requested = process.argv.slice(2);
    const unknown = requested.filter((file) => !examples.some((example) => example.file === file));
    if (unknown.length) throw new Error(`Unknown preview: ${unknown.join(', ')}`);
    const selected = requested.length
        ? examples.filter((example) => requested.includes(example.file))
        : examples;

    // The cards are actual bot output, captured at high pixel density so they
    // remain crisp when displayed on GitHub and high-resolution screens.
    config.puppeteer.launchArgs.defaultViewport = { width: 1200, height: 1200, deviceScaleFactor: 2 };
    config.bot.useFallback = false;
    fs.mkdirSync(outputDir, { recursive: true });

    try {
        await renderer.initialize();
        if (!renderer.isLocalReady()) throw new Error('A working local Chromium renderer is required.');
        for (const example of selected) {
            const originalCreatePage = katex.createRenderPage;
            if (example.animated) {
                // Video frames have no alpha channel; use the card color as
                // their matte so transparent corners do not turn white.
                katex.createRenderPage = async () => {
                    const page = await originalCreatePage();
                    await page.evaluate((color) => { document.documentElement.style.backgroundColor = color; }, config.style.backgroundColor);
                    return page;
                };
            }
            let result;
            try {
                result = await example.handler(example.command);
            } finally {
                katex.createRenderPage = originalCreatePage;
            }
            if (!result.success || !result.data) {
                throw new Error(`${example.file}: ${result.error || 'No media returned.'}`);
            }
            if (example.animated && result.mimeType !== 'video/mp4') {
                throw new Error(`${example.file}: ffmpeg is required to render the animation.`);
            }
            const media = Buffer.from(result.data, 'base64');
            fs.writeFileSync(path.join(outputDir, example.file), example.animated ? makeGif(media) : media);
            console.log(`Generated ${example.file}`);
        }
    } finally {
        await renderer.close();
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
