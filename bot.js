const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const renderer = require('./renderer');
const solver = require('./solver');
const config = require('./config');
const { create, all } = require('mathjs');
const math = create(all);

const deriv = function (expr, varName, val) {
    return math.derivative(expr, varName).evaluate({ [varName]: val });
};
deriv.toTex = function (node, options) {
    const exprStr = node.args[0].value;
    const varStr = node.args[1].value;
    const innerTex = math.parse(exprStr).toTex();
    return `\\frac{d}{d${varStr}}\\left(${innerTex}\\right)`;
};

const integ = function (expr, varName, lower, upper) {
    const compiled = math.compile(expr);
    const f = (val) => compiled.evaluate({ [varName]: val });
    const n = 100;
    const h = (upper - lower) / n;
    let sum = 0.5 * (f(lower) + f(upper));
    for (let i = 1; i < n; i++) {
        sum += f(lower + i * h);
    }
    return sum * h;
};
integ.toTex = function (node, options) {
    const exprStr = node.args[0].value;
    const varStr = node.args[1].value;
    const lowerTex = node.args[2].toTex(options);
    const upperTex = node.args[3].toTex(options);
    const innerTex = math.parse(exprStr).toTex();
    return `\\int_{${lowerTex}}^{${upperTex}} ${innerTex} d${varStr}`;
};

const originalFactorial = math.factorial;
const factorial = function (x) {
    if (typeof x === 'number') {
        if (x < 0) return math.gamma(x + 1);
        return originalFactorial(x);
    }
    if (x && x.isBigNumber) {
        if (x.isNegative()) return math.gamma(x.toNumber() + 1);
        return originalFactorial(x);
    }
    if (x && x.isFraction) {
        const val = x.valueOf();
        if (val < 0) return math.gamma(val + 1);
        return originalFactorial(x);
    }
    if (x && x.isComplex) {
        return math.gamma(math.add(x, 1));
    }
    return originalFactorial(x);
};

math.import({
    arcsin: math.asin,
    arccos: math.acos,
    arctan: math.atan,
    arccot: math.acot,
    arcsec: math.asec,
    arccsc: math.acsc,
    arcsinh: math.asinh,
    arccosh: math.acosh,
    arctanh: math.atanh,
    arccoth: math.acoth,
    arcsech: math.asech,
    arccsch: math.acsch,
    cosec: math.csc,
    cosech: math.csch,
    ln: math.log,
    tg: math.tan,
    ctg: math.cot,
    arctg: math.atan,
    arcctg: math.acot,
    deriv,
    integ,
    factorial
}, { override: true });


const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: config.puppeteer.launchArgs.args,
        headless: config.puppeteer.launchArgs.headless
    }
});

client.on('qr', (qr) => {
    console.log('\n--- SCAN THIS QR CODE WITH WHATSAPP LINKED DEVICES ---');
    qrcode.generate(qr, { small: true });
    console.log('-------------------------------------------------------\n');
});

client.on('authenticated', () => console.log('Authenticated.'));
client.on('auth_failure', (msg) => console.error('Auth failure:', msg));
client.on('change_state', (state) => console.log(`Connection state: ${state}`));
client.on('disconnected', (reason) => console.error('Disconnected:', reason));

client.on('ready', async () => {
    console.log(`\n==================================================`);
    console.log(`Bot "${config.bot.name}" is now connected and ready!`);
    console.log(`==================================================\n`);
    await renderer.initialize();
});

/**
 * Checks if `body` starts with `prefix + ' '` and returns the text after it,
 * or null if it doesn't match.
 */
function parseCommand(body, prefix) {
    if (body.startsWith(prefix + ' ')) {
        return body.slice(prefix.length + 1).trim();
    }
    return null;
}

client.on('message_create', async (msg) => {
    if (!msg.body || typeof msg.body !== 'string') return;

    const body = msg.body.trim();
    if (body.startsWith('*LaTeX Render Bot Help Menu*')) return;

    if (body.startsWith('!') || body.includes('$$')) {
        const snippet = body.substring(0, 40).replace(/\n/g, ' ');
        console.log(`msg from [${msg.author || msg.from}]: "${snippet}${body.length > 40 ? '...' : ''}"`);
    }

    if (body.toLowerCase() === '!help') {
        const helpText = [
            '*LaTeX Render Bot Help Menu*',
            '',
            'Welcome to the LaTeX & Graphing Bot! Here are all the commands you can use to render math, chemistry, diagrams, and plots.',
            '',
            '──────────────────────────',
            '',
            '*1. LaTeX / Mathematics*',
            '• *Command:* `!latex <formula>` (or `!tex`)',
            '  _Example:_ `!latex \\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}`',
            '• *Inline Blocks:* Wrap formulas in `$$` anywhere in your text.',
            '  _Example:_ `The solution to $x^2=4$ is $$x = \\pm 2$$`',
            '',
            '*2. Symbolic Calculus*',
            '• *Differentiation:* `!diff <expression> [variable]`',
            '  _Example:_ `!diff x^2 * sin(x)` or `!diff u^3 - u y, u`',
            '• *Integration:* `!int <expression> [variable] [lower] [upper]`',
            '  _Example:_ `!int x^2` or `!int sin(x) x 0 pi`',
            '',
            '*3. Chemistry Structures*',
            '• *Command:* `!chem <formula>` (or `!chemfig`)',
            '  _Example:_ `!chem \\chemfig{A-B*6(=-=-=-)}`',
            '',
            '*4. TikZ Diagrams*',
            '• *Command:* `!tikz <tikz code>`',
            '  _Example:_',
            '  `!tikz`',
            '  `\\draw[thick, fill=blue!10] (0,0) circle (1.5);`',
            '  `\\node at (0,0) {Hello!};`',
            '',
            '*5. Function & Equation Plotting*',
            '• *Command:* `!plot <expression> [xRange] [yRange]`',
            '  _Plots lines, implicit curves, vector fields, derivatives, and integrals on a square coordinate grid._',
            '',
            '  *a) Explicit Functions:*',
            '  • `!plot y = x^2 - 4`',
            '  • `!plot sin(x) * cos(x/2) [-10, 10] [-2, 2]`',
            '',
            '  *b) Implicit Equations:*',
            '  • `!plot x^2 + y^2 = 9` (renders a circle)',
            '  • `!plot y^2 = x^3 - x [-2, 2] [-2, 2]`',
            '',
            '  *c) Vector Fields:*',
            '  • `!plot v(x,y) = (-y, x) [-5, 5] [-5, 5]`',
            '',
            '  *d) Derivatives:*',
            '  • `!plot y = deriv("x^3", "x", x) [-3, 3] [-10, 10]`',
            '',
            '  *e) Definite Integrals:*',
            '  • `!plot y = integ("sin(t)", "t", 0, x) [-10, 10] [-3, 3]`',
            '',
            '*6. Equation Solver*',
            '• *Command:* `!solve <equation(s)>`',
            '  _Solves equations or linear systems (returns a styled card with symbolic roots or numerical convergence steps)._',
            '  • `!solve x^2 - 5x + 6 = 0` (symbolic quadratic)',
            '  • `!solve cos(x) - x = 0` (numerical Newton-Raphson)',
            '  • `!solve x + y = 5; x - y = 1` (linear system)',
            '',
            '*7. Differential Equations Solver*',
            '• *Command:* `!ode [options] <equation(s)>, <initial condition(s)> [xRange] [yRange]`',
            '  _Solves first-order, higher-order ODEs, and systems of ODEs symbolically or numerically, rendering the trajectory plot._',
            '  • `!ode dy/dx = -y, y(0) = 1` (default hybrid solving)',
            '  • `!ode -s y\'\' + y = 0, y(0)=1, y\'(0)=0` (symbolic-only flag)',
            '  • `!ode -n dx/dt = -y; dy/dt = x, x(0)=1, y(0)=0 [-5, 5]` (numerical-only system)',
            '',
            '*8. Symbolic Variable Rearrangement*',
            '• *Command:* `!desp <equation> for <variable>`',
            '  _Symbolically rearranges and isolates the target variable in the given equation._',
            '  • `!desp E = m * c^2 for c` (isolates c)',
            '  • `!desp PV = n*R*T for T` (isolates T)',
            '',
            '──────────────────────────',
            '*Tip:* Wrap ranges in brackets `[min, max]`. If you specify one range, it defines the X-axis limits. If you specify two, they define the X and Y limits respectively.'
        ].join('\n');

        try {
            await msg.reply(helpText);
        } catch (err) {
            console.error('Failed to send help message:', err.message);
        }
        return;
    }

    let triggered = false;
    let mode = null;   // 'latex' | 'chem' | 'tikz' | 'plot' | 'solve' | 'mixed'
    let input = '';

    const latexInput = parseCommand(body, '!latex') || parseCommand(body, '!tex');
    const chemInput = parseCommand(body, '!chem') || parseCommand(body, '!chemfig');
    const tikzInput = parseCommand(body, '!tikz');
    const plotInput = parseCommand(body, '!plot');
    const solveInput = parseCommand(body, '!solve');
    const odeInput = parseCommand(body, '!ode');
    const despInput = parseCommand(body, '!desp');
    const diffInput = parseCommand(body, '!diff');
    const intInput = parseCommand(body, '!int');

    if (latexInput) {
        triggered = true; mode = 'latex'; input = latexInput;
    } else if (chemInput) {
        triggered = true; mode = 'chem'; input = chemInput;
    } else if (tikzInput) {
        triggered = true; mode = 'tikz'; input = tikzInput;
    } else if (plotInput) {
        triggered = true; mode = 'plot'; input = plotInput;
    } else if (solveInput) {
        triggered = true; mode = 'solve'; input = solveInput;
    } else if (odeInput) {
        triggered = true; mode = 'ode'; input = odeInput;
    } else if (despInput) {
        triggered = true; mode = 'desp'; input = despInput;
    } else if (diffInput) {
        triggered = true; mode = 'diff'; input = diffInput;
    } else if (intInput) {
        triggered = true; mode = 'int'; input = intInput;
    } else if (body.includes('\\begin{tikzpicture}')) {
        triggered = true; mode = 'tikz'; input = body;
    } else if (config.bot.autoRenderBlock && body.includes('$$')) {
        const first = body.indexOf('$$');
        const last = body.lastIndexOf('$$');
        if (first !== last) {
            triggered = true; mode = 'mixed'; input = body;
        }
    }

    if (!triggered) return;

    // Rate limiting
    const sender = msg.author || msg.from;
    if (renderer.isRateLimited(sender)) {
        console.warn(`Rate limited: ${sender}`);
        try { await msg.reply(`${config.bot.errorPrefix}Too many requests. Please wait a moment before sending another formula.`); } catch (_) { }
        return;
    }

    const lengthErr = renderer.validateInputLength(input);
    if (lengthErr) {
        console.warn(`Input rejected (${sender}): ${lengthErr}`);
        try { await msg.reply(`${config.bot.errorPrefix}${lengthErr}`); } catch (_) { }
        return;
    }

    console.log(`Processing LaTeX request from: ${sender}`);
    try {
        try {
            const chat = await msg.getChat();
            await chat.sendStateTyping();
        } catch (e) {
            console.warn('Failed to set typing state:', e.message);
        }

        let result;
        if (mode === 'chem') {
            result = await renderer.renderChem(input);
        } else if (mode === 'tikz') {
            result = await renderer.renderTikz(input);
        } else if (mode === 'plot') {
            result = await handlePlotCommand(input);
        } else if (mode === 'solve') {
            result = await handleSolveCommand(input);
        } else if (mode === 'ode') {
            result = await handleOdeCommand(input);
        } else if (mode === 'desp') {
            result = await handleRearrangeCommand(input);
        } else if (mode === 'diff') {
            result = await handleDiffCommand(input);
        } else if (mode === 'int') {
            result = await handleIntCommand(input);
        } else if (mode === 'latex') {
            result = await renderer.render(input, true);
        } else {
            result = await renderMixed(input);
        }

        if (result.success && result.data) {
            const media = new MessageMedia('image/png', result.data, 'latex.png');
            await msg.reply(media);
            console.log(`Replied with rendered image (source: ${result.source})`);
        } else {
            await msg.reply(`${config.bot.errorPrefix}${result.error}`);
            console.log(`Render failed: ${result.error}`);
        }
    } catch (err) {
        console.error('Error handling message:', err);
        try {
            await msg.reply(`${config.bot.errorPrefix}An unexpected error occurred during rendering.`);
        } catch (replyErr) {
            console.error('Failed to send error reply:', replyErr);
        }
    }
});

/**
 * Renders mixed text+equations ($$...$$) locally, falling back to extracting
 * the first equation for the API if Puppeteer is down.
 */
async function renderMixed(text) {
    if (renderer.isLocalReady()) {
        try {
            return await renderer.render(text, false);
        } catch (err) {
            console.warn('Local mixed rendering failed, falling back...');
        }
    }

    // Fallback: extract the first $$ block and send it to the API
    const first = text.indexOf('$$');
    const second = text.indexOf('$$', first + 2);

    if (first !== -1 && second !== -1) {
        const extracted = text.substring(first + 2, second).trim();
        if (extracted) {
            console.log(`Fallback: rendering extracted formula: ${extracted}`);
            return await renderer.render(extracted, true);
        }
    }

    return {
        success: false,
        error: 'Local mixed rendering unavailable, and could not extract formula for API fallback.'
    };
}

async function handlePlotCommand(input) {
    let expr = input.trim();

    const rangeMatches = [...expr.matchAll(/\[([^\]]+)\]/g)];

    let xDomain = null;
    let yDomain = null;

    if (rangeMatches.length > 0) {
        try {
            const parts = rangeMatches[0][1].split(',');
            const lo = math.evaluate(parts[0].trim());
            const hi = math.evaluate(parts[1].trim());
            if (!isNaN(lo) && !isNaN(hi) && lo < hi) xDomain = [lo, hi];
            expr = expr.replace(rangeMatches[0][0], '');
        } catch (e) {
            console.warn('Failed to parse X domain:', e.message);
        }
    }

    if (rangeMatches.length > 1) {
        try {
            const parts = rangeMatches[1][1].split(',');
            const lo = math.evaluate(parts[0].trim());
            const hi = math.evaluate(parts[1].trim());
            if (!isNaN(lo) && !isNaN(hi) && lo < hi) yDomain = [lo, hi];
            expr = expr.replace(rangeMatches[1][0], '');
        } catch (e) {
            console.warn('Failed to parse Y domain:', e.message);
        }
    }

    expr = expr.trim();

    const opts = {};
    if (xDomain) opts.xDomain = xDomain;
    if (yDomain) opts.yDomain = yDomain;

    return await renderer.renderPlot(expr, opts);
}

async function handleSolveCommand(input) {
    const solveRes = solver.solveEquation(input);
    if (!solveRes.success) {
        return { success: false, error: solveRes.error };
    }
    return await renderer.render(solveRes.latex, true);
}

async function handleRearrangeCommand(input) {
    const rearrangeRes = await solver.rearrangeEquation(input);
    if (!rearrangeRes.success) {
        return { success: false, error: rearrangeRes.error };
    }
    return await renderer.render(rearrangeRes.latex, true);
}

async function handleDiffCommand(input) {
    const diffRes = await solver.solveDerivative(input);
    if (!diffRes.success) {
        return { success: false, error: diffRes.error };
    }
    return await renderer.render(diffRes.latex, true);
}

async function handleIntCommand(input) {
    const intRes = await solver.solveIntegral(input);
    if (!intRes.success) {
        return { success: false, error: intRes.error };
    }
    return await renderer.render(intRes.latex, true);
}

async function handleOdeCommand(input) {
    const odeRes = await solver.solveOde(input);
    if (!odeRes.success) {
        return { success: false, error: odeRes.error };
    }

    const latexText = odeRes.has_symbolic ? odeRes.symbolic_latex : odeRes.ode_latex;

    // Determine Y domain if not explicitly provided
    let yDomain = odeRes.yDomain;
    if (!yDomain) {
        let yValues = [];
        Object.values(odeRes.curves).forEach(points => {
            points.forEach(pt => {
                if (pt.y !== null && !isNaN(pt.y) && isFinite(pt.y)) {
                    yValues.push(pt.y);
                }
            });
        });

        if (yValues.length > 0) {
            const minVal = Math.min(...yValues);
            const maxVal = Math.max(...yValues);
            const range = maxVal - minVal;
            const pad = Math.max(range * 0.15, 1.0); // 15% padding
            yDomain = [minVal - pad, maxVal + pad];
        } else {
            yDomain = [-10, 10];
        }
    }

    return await renderer.renderOde(latexText, odeRes.curves, {
        xDomain: odeRes.xDomain,
        yDomain: yDomain
    });
}

console.log('Starting LaTeX Render Bot...');
client.initialize().catch(err => {
    console.error('Failed to initialize WhatsApp client:', err);
});
