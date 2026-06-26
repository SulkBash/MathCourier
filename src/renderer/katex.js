const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { pathToFileURL } = require('url');
const { resolvePuppeteerLaunchOptions, resolveRuntimePaths } = require('../runtime');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const KATEX_DIST_DIR = path.join(PROJECT_ROOT, 'node_modules', 'katex', 'dist');
const PLOTLY_DIST_PATH = path.join(PROJECT_ROOT, 'node_modules', 'plotly.js-dist-min', 'plotly.min.js');

let browser = null;
let page = null;
let templatePath = null;
let templateUrl = null;
let isInitialized = false;

function buildTemplateUrl(filePath) {
    return pathToFileURL(filePath).toString();
}

function ensureFileExists(filePath, message) {
    if (!fs.existsSync(filePath)) {
        throw new Error(message);
    }

    return filePath;
}

function ensureRuntimeRenderDir() {
    const runtimeRenderDir = resolveRuntimePaths().rendererCacheDir;
    fs.mkdirSync(runtimeRenderDir, { recursive: true });
    return runtimeRenderDir;
}

function getRuntimeTemplatePath() {
    return path.join(ensureRuntimeRenderDir(), 'render.html');
}

function replaceTemplateToken(templateHtml, token, value) {
    return templateHtml.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
}

function buildTemplateHtml() {
    const katexCssPath = ensureFileExists(
        path.join(KATEX_DIST_DIR, 'katex.min.css'),
        'KaTeX CSS file not found. Run npm install first.'
    );
    const katexJsPath = ensureFileExists(
        path.join(KATEX_DIST_DIR, 'katex.min.js'),
        'KaTeX JS file not found. Run npm install first.'
    );
    const mhchemJsPath = ensureFileExists(
        path.join(KATEX_DIST_DIR, 'contrib', 'mhchem.min.js'),
        'KaTeX mhchem helper not found. Run npm install first.'
    );
    const autoRenderJsPath = ensureFileExists(
        path.join(KATEX_DIST_DIR, 'contrib', 'auto-render.min.js'),
        'KaTeX auto-render helper not found. Run npm install first.'
    );

    let plotlyScriptSrc = null;
    if (fs.existsSync(PLOTLY_DIST_PATH)) {
        plotlyScriptSrc = buildTemplateUrl(PLOTLY_DIST_PATH);
    } else {
        console.warn('Plotly.js local asset not found. 3D rendering will remain unavailable until dependencies are installed.');
    }

    const staticTemplatePath = path.join(__dirname, 'template.html');
    let templateHtml = fs.readFileSync(staticTemplatePath, 'utf8');

    templateHtml = replaceTemplateToken(templateHtml, '{{katexCssHref}}', buildTemplateUrl(katexCssPath));
    templateHtml = replaceTemplateToken(templateHtml, '{{katexJsSrc}}', buildTemplateUrl(katexJsPath));
    templateHtml = replaceTemplateToken(templateHtml, '{{mhchemJsSrc}}', buildTemplateUrl(mhchemJsPath));
    templateHtml = replaceTemplateToken(templateHtml, '{{autoRenderJsSrc}}', buildTemplateUrl(autoRenderJsPath));

    const renderConfig = JSON.stringify({
        plotlyScriptSrc,
        style: config.style
    }).replace(/</g, '\\u003c');

    return templateHtml.replace('{{renderConfig}}', renderConfig);
}

function writeRuntimeTemplate() {
    templatePath = getRuntimeTemplatePath();
    fs.writeFileSync(templatePath, buildTemplateHtml(), 'utf8');
    templateUrl = buildTemplateUrl(templatePath);
}

async function openRenderPage(browserInstance) {
    if (!templateUrl) {
        throw new Error('Renderer template URL is not initialized.');
    }

    const renderPage = await browserInstance.newPage();
    try {
        await renderPage.goto(templateUrl, { waitUntil: 'load' });
        return renderPage;
    } catch (err) {
        try { await renderPage.close(); } catch (closeErr) { }
        throw err;
    }
}

async function initialize() {
    if (isInitialized) return;

    try {
        console.log('Initializing LaTeX Renderer...');

        writeRuntimeTemplate();

        browser = await puppeteer.launch(resolvePuppeteerLaunchOptions(config.puppeteer.launchArgs));
        page = await openRenderPage(browser);
        
        isInitialized = true;
        console.log('LaTeX Renderer initialized successfully.');
    } catch (err) {
        console.error('Failed to initialize local Puppeteer renderer:', err.message);
        console.log('Renderer will operate in Fallback API Mode.');
        isInitialized = false;
        templateUrl = null;
        
        if (browser) {
            try { await browser.close(); } catch (e) {}
            browser = null;
            page = null;
        }
    }
}

async function createRenderPage() {
    if (!isInitialized || !browser) {
        throw new Error('Local renderer is not initialized.');
    }

    return openRenderPage(browser);
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
    isInitialized = false;
    templateUrl = null;
    page = null;

    if (browser) {
        const browserToClose = browser;
        browser = null;
        await browserToClose.close();

        console.log('LaTeX Renderer shut down.');
    }
}

module.exports = {
    initialize,
    renderLocal,
    close,
    isInitialized: () => isInitialized,
    getPage: () => page,
    getBrowser: () => browser,
    getTemplatePath: () => templatePath,
    createRenderPage
};
