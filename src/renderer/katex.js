const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https');
const config = require('../../config');

let browser = null;
let page = null;
let templatePath = null;
let isInitialized = false;

function downloadPlotly(destPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        https.get('https://cdn.plot.ly/plotly-2.27.0.min.js', (response) => {
            if (response.statusCode !== 200) {
                file.close();
                fs.unlink(destPath, () => {});
                reject(new Error(`Failed to download Plotly.js: status code ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            file.close();
            fs.unlink(destPath, () => {});
            reject(err);
        });
    });
}

async function initialize() {
    if (isInitialized) return;

    try {
        console.log('Initializing LaTeX Renderer...');
        
        const katexDir = path.join(__dirname, '..', '..', 'node_modules', 'katex', 'dist');
        const katexCssPath = path.join(katexDir, 'katex.min.css');
        const katexJsPath = path.join(katexDir, 'katex.min.js');
        
        if (!fs.existsSync(katexCssPath) || !fs.existsSync(katexJsPath)) {
            throw new Error('KaTeX node_modules files not found. Run npm install first.');
        }

        // Check and download Plotly.js if missing
        const plotlyJsPath = path.join(katexDir, 'plotly.min.js');
        let useLocalPlotly = false;
        if (fs.existsSync(plotlyJsPath)) {
            useLocalPlotly = true;
        } else {
            console.log('Plotly.js not found locally. Attempting to download...');
            try {
                await downloadPlotly(plotlyJsPath);
                useLocalPlotly = true;
                console.log('Plotly.js downloaded successfully.');
            } catch (err) {
                console.warn('Failed to download Plotly.js locally:', err.message);
                console.log('Plotly.js will be loaded via CDN fallback.');
            }
        }

        const plotlyScriptSrc = useLocalPlotly
            ? 'plotly.min.js'
            : 'https://cdn.plot.ly/plotly-2.27.0.min.js';

        // Read template.html
        const staticTemplatePath = path.join(__dirname, 'template.html');
        let templateHtml = fs.readFileSync(staticTemplatePath, 'utf8');

        // Replace placeholders with a single JSON config blob so the template remains valid HTML/CSS.
        const renderConfig = JSON.stringify({
            plotlyScriptSrc,
            style: config.style
        }).replace(/</g, '\\u003c');

        templateHtml = templateHtml.replace('{{renderConfig}}', renderConfig);

        // Write the temp template inside katex/dist so relative font paths resolve naturally
        templatePath = path.join(katexDir, 'render_temp.html');
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

module.exports = {
    initialize,
    renderLocal,
    close,
    isInitialized: () => isInitialized,
    getPage: () => page,
    getBrowser: () => browser
};
