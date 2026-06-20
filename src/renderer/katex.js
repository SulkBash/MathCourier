const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const config = require('../../config');

let browser = null;
let page = null;
let templatePath = null;
let isInitialized = false;

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

        // Read template.html
        const staticTemplatePath = path.join(__dirname, 'template.html');
        let templateHtml = fs.readFileSync(staticTemplatePath, 'utf8');

        // Replace placeholders with style variables from config
        templateHtml = templateHtml
            .replace('{{style.backgroundColor}}', config.style.backgroundColor)
            .replace('{{style.textColor}}', config.style.textColor)
            .replace('{{style.fontFamily}}', config.style.fontFamily)
            .replace('{{style.fontSize}}', config.style.fontSize)
            .replace('{{style.padding}}', config.style.padding)
            .replace('{{style.borderRadius}}', config.style.borderRadius)
            .replace('{{style.border}}', config.style.border)
            .replace('{{style.boxShadow}}', config.style.boxShadow)
            .replace('{{style.watermark.margin}}', config.style.watermark.text ? '12px' : '0')
            .replace('{{style.watermark.color}}', config.style.watermark.color)
            .replace('{{style.watermark.fontSize}}', config.style.watermark.fontSize)
            .replace('{{style.watermark.fontFamily}}', config.style.watermark.fontFamily)
            .replace('{{style.watermark.text}}', config.style.watermark.text || '');

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
