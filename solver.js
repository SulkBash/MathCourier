const { create, all } = require('mathjs');
const math = create(all);
const { spawn } = require('child_process');
const path = require('path');

const SUBPROCESS_TIMEOUT_MS = 30000;
const SUBPROCESS_MAX_STDOUT = 512 * 1024;

function runSubprocess(scriptPath, payload) {
    return new Promise((resolve) => {
        let stdoutData = '';
        let stderrData = '';
        let settled = false;

        const pyProcess = spawn('python', [scriptPath]);

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            try {
                pyProcess.kill('SIGKILL');
            } catch (_) {}
            resolve({ success: false, error: 'Computation timed out (max 30 s). Try a simpler expression.' });
        }, SUBPROCESS_TIMEOUT_MS);

        pyProcess.stdout.on('data', (data) => {
            stdoutData += data.toString();
            if (stdoutData.length > SUBPROCESS_MAX_STDOUT) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                try {
                    pyProcess.kill('SIGKILL');
                } catch (_) {}
                resolve({ success: false, error: 'Solver output limit exceeded.' });
            }
        });

        pyProcess.stderr.on('data', (data) => {
            stderrData += data.toString();
        });

        pyProcess.on('close', (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);

            if (code !== 0) {
                console.error(`Python [${path.basename(scriptPath)}] exited with code ${code}. Stderr: ${stderrData}`);
                return resolve({ success: false, error: 'Internal solver error. The expression may be malformed or unsupported.' });
            }

            try {
                const response = JSON.parse(stdoutData.trim());
                resolve(response);
            } catch (err) {
                console.error('Failed to parse Python output:', stdoutData);
                resolve({ success: false, error: `Failed to parse solver response: ${err.message}` });
            }
        });

        pyProcess.stdin.write(JSON.stringify(payload));
        pyProcess.stdin.end();
    });
}


function digamma(x) {
    if (x <= 0) {
        if (Math.sin(Math.PI * x) === 0) return NaN;
        return digamma(1 - x) - Math.PI / Math.tan(Math.PI * x);
    }
    let shift = 0;
    while (x < 8.0) {
        shift -= 1.0 / x;
        x += 1.0;
    }
    const r = 1.0 / x;
    const r2 = r * r;
    let val = Math.log(x) - 0.5 * r;
    val -= r2 * (1.0 / 12.0 - r2 * (1.0 / 120.0 - r2 * (1.0 / 252.0 - r2 * (1.0 / 240.0))));
    return val + shift;
}

function polygamma(n, x) {
    if (typeof n !== 'number' || typeof x !== 'number') {
        n = Number(n);
        x = Number(x);
    }
    if (isNaN(n) || isNaN(x)) return NaN;
    if (n < 0 || !Number.isInteger(n)) return NaN;
    if (n === 0) return digamma(x);
    
    let shift = 0;
    let tempX = x;
    const sign = (n % 2 === 0) ? -1 : 1;
    let fact = 1;
    for (let i = 2; i <= n; i++) fact *= i;
    
    while (tempX < 8.0) {
        if (tempX === 0) return NaN;
        shift += sign * fact / Math.pow(tempX, n + 1);
        tempX += 1.0;
    }
    
    const r = 1.0 / tempX;
    let leadFact = 1;
    for (let i = 2; i <= n - 1; i++) leadFact *= i;
    const leadSign = (n % 2 === 0) ? -1 : 1;
    let val = leadSign * leadFact * Math.pow(r, n);
    
    val += leadSign * fact * 0.5 * Math.pow(r, n + 1);
    
    let term1 = fact * (n + 1) / (12.0 * Math.pow(tempX, n + 2));
    let term2 = fact * (n + 1) * (n + 2) * (n + 3) / (720.0 * Math.pow(tempX, n + 4));
    let term3 = fact * (n + 1) * (n + 2) * (n + 3) * (n + 4) * (n + 5) / (30240.0 * Math.pow(tempX, n + 6));
    
    val += leadSign * (term1 - term2 + term3);
    return val + shift;
}
polygamma.toTex = function (node, options) {
    const nTex = node.args[0].toTex(options);
    const xTex = node.args[1].toTex(options);
    return `\\psi^{(${nTex})}\\left(${xTex}\\right)`;
};

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
    factorial,
    polygamma
}, { override: true });

function extractVariables(node) {
    const vars = new Set();
    node.traverse(function (child, path, parent) {
        if (child.isSymbolNode) {
            // Ignore function names when they are the function being called
            if (parent && parent.isFunctionNode && parent.fn === child) {
                return;
            }
            const name = child.name;
            // Filter out common math constants and functions
            const ignored = ['pi', 'e', 'i', 'true', 'false', 'NaN', 'null', 'Infinity'];
            if (!ignored.includes(name) && !math[name]) {
                vars.add(name);
            }
        }
    });
    return Array.from(vars);
}

function formatVal(val) {
    if (val === null || isNaN(val)) return '\\text{NaN}';
    if (!isFinite(val)) return val > 0 ? '\\infty' : '-\\infty';
    if (Math.abs(val) < 1e-10) return '0';
    if (Math.abs(val) < 1e-3 || Math.abs(val) > 1e6) {
        // scientific notation formatted in LaTeX
        const str = val.toExponential(4);
        const parts = str.split('e');
        const num = parts[0];
        const exp = parseInt(parts[1], 10);
        return `${num} \\times 10^{${exp}}`;
    }
    return Number(val.toFixed(6)).toString();
}

function solveEquation(inputStr) {
    const eqStrs = inputStr.split(';').map(s => s.trim()).filter(Boolean);
    if (eqStrs.length === 0) {
        return { success: false, error: 'No equation provided.' };
    }

    const allVars = new Set();
    const parsedEqs = [];
    
    for (const eqStr of eqStrs) {
        let normalized = '';
        if (eqStr.includes('=')) {
            const idx = eqStr.indexOf('=');
            const lhs = eqStr.substring(0, idx).trim();
            const rhs = eqStr.substring(idx + 1).trim();
            normalized = `(${lhs}) - (${rhs})`;
        } else {
            normalized = eqStr;
        }
        
        try {
            const node = math.parse(normalized);
            parsedEqs.push({ node, str: eqStr });
            const eqVars = extractVariables(node);
            eqVars.forEach(v => allVars.add(v));
        } catch (err) {
            return { success: false, error: `Parsing error in equation "${eqStr}": ${err.message}` };
        }
    }

    const variables = Array.from(allVars).sort();
    const m = parsedEqs.length;
    const n = variables.length;

    // Case 0: No variables
    if (n === 0) {
        try {
            const E = parsedEqs[0].node;
            const val = E.evaluate();
            const isTautology = Math.abs(val) < 1e-10;
            let latex = '\\begin{aligned}\n';
            let eqTex = '';
            try {
                if (parsedEqs[0].str.includes('=')) {
                    const parts = parsedEqs[0].str.split('=');
                    eqTex = `${math.parse(parts[0]).toTex()} = ${math.parse(parts[1]).toTex()}`;
                } else {
                    eqTex = `${math.parse(parsedEqs[0].str).toTex()} = 0`;
                }
            } catch (e) {
                eqTex = parsedEqs[0].str;
            }
            latex += `${eqTex} \\\\\n`;
            if (isTautology) {
                latex += '\\implies \\text{Tautology (always true)}\n';
            } else {
                latex += '\\implies \\text{Contradiction (no solution)}\n';
            }
            latex += '\\end{aligned}';
            return { success: true, latex };
        } catch (err) {
            return { success: false, error: `Evaluation error: ${err.message}` };
        }
    }

    // Case 1: System of linear equations (or multi-equation systems)
    if (m > 1 || n > 1) {
        let isLinearSystem = true;
        const A = [];
        const b = [];
        
        for (let j = 0; j < m; j++) {
            const E = parsedEqs[j].node;
            const rowCoeffs = [];
            for (let i = 0; i < n; i++) {
                const xVar = variables[i];
                try {
                    const D = math.derivative(E, xVar);
                    const D_simp = math.simplify(D);
                    const dVars = extractVariables(D_simp);
                    if (dVars.length > 0) {
                        isLinearSystem = false;
                        break;
                    }
                    const val = math.evaluate(D_simp.toString());
                    rowCoeffs.push(val);
                } catch (e) {
                    isLinearSystem = false;
                    break;
                }
            }
            if (!isLinearSystem) break;
            
            const zeroScope = {};
            variables.forEach(v => { zeroScope[v] = 0; });
            try {
                const c_j = E.evaluate(zeroScope);
                A.push(rowCoeffs);
                b.push(-c_j);
            } catch (e) {
                isLinearSystem = false;
                break;
            }
        }

        if (!isLinearSystem) {
            return { success: false, error: 'Non-linear systems of equations are not supported. Only single non-linear equations or systems of linear equations are supported.' };
        }

        if (m !== n) {
            return { success: false, error: `Linear system is not square: ${m} equations but ${n} variables (${variables.join(', ')}). A unique solution requires exactly as many equations as variables.` };
        }

        try {
            const sol = math.lusolve(A, b);
            let latex = '\\begin{aligned}\n';
            latex += '\\begin{cases}\n';
            latex += parsedEqs.map(eq => {
                try {
                    if (eq.str.includes('=')) {
                        const parts = eq.str.split('=');
                        return `${math.parse(parts[0]).toTex()} = ${math.parse(parts[1]).toTex()}`;
                    }
                    return `${math.parse(eq.str).toTex()} = 0`;
                } catch (e) {
                    return eq.str;
                }
            }).join(' \\\\\n') + '\n\\end{cases} \\\\\n';
            latex += '\\implies ';
            const solLines = [];
            for (let i = 0; i < n; i++) {
                const val = sol[i][0];
                let formattedVal;
                if (typeof val === 'number') {
                    formattedVal = Number(val.toFixed(8)).toString();
                } else if (val && val.isComplex) {
                    const re = Number(val.re.toFixed(8)).toString();
                    const im = Number(val.im.toFixed(8)).toString();
                    if (Math.abs(val.im) < 1e-10) {
                        formattedVal = re;
                    } else {
                        const sign = val.im >= 0 ? '+' : '-';
                        const imAbs = Math.abs(val.im);
                        const imStr = imAbs === 1 ? 'i' : `${Number(imAbs.toFixed(8)).toString()}i`;
                        formattedVal = `${re} ${sign} ${imStr}`;
                    }
                } else {
                    formattedVal = math.format(val, { precision: 8 });
                }
                solLines.push(`${variables[i]} = ${formattedVal}`);
            }
            latex += solLines.join(', \\quad ') + '\n\\end{aligned}';
            return { success: true, latex };
        } catch (err) {
            return { success: false, error: `Could not solve linear system: ${err.message}` };
        }
    }

    // Case 2: Single equation with exactly one variable
    const xVar = variables[0];
    const E = parsedEqs[0].node;
    
    let eqTex = '';
    try {
        if (parsedEqs[0].str.includes('=')) {
            const parts = parsedEqs[0].str.split('=');
            eqTex = `${math.parse(parts[0]).toTex()} = ${math.parse(parts[1]).toTex()}`;
        } else {
            eqTex = `${math.parse(parsedEqs[0].str).toTex()} = 0`;
        }
    } catch (e) {
        eqTex = parsedEqs[0].str;
    }

    // Try Symbolic Linear Solver first
    let isLinear = false;
    let linearCoeff = null;
    let constTerm = null;
    try {
        const D = math.derivative(E, xVar);
        const D_simp = math.simplify(D);
        const dVars = extractVariables(D_simp);
        if (dVars.length === 0) {
            isLinear = true;
            linearCoeff = math.evaluate(D_simp.toString());
            constTerm = E.evaluate({ [xVar]: 0 });
        }
    } catch (e) {}

    if (isLinear && linearCoeff !== 0) {
        const root = -constTerm / linearCoeff;
        const rootStr = Number(root.toFixed(8)).toString();
        let latex = '\\begin{aligned}\n';
        latex += `${eqTex} \\\\\n`;
        latex += `\\implies ${xVar} = ${rootStr}\n`;
        latex += '\\end{aligned}';
        return { success: true, latex };
    }

    // Try Symbolic Polynomial Solver (degree 2 and 3)
    let isPolynomial = false;
    let polyRoots = null;
    let polyDegree = 0;
    try {
        const rat = math.rationalize(E, {}, true);
        if (rat.variables.length === 1 && rat.variables[0] === xVar && (rat.denominator === null || rat.denominator === undefined)) {
            isPolynomial = true;
            const coeffs = rat.coefficients;
            polyDegree = coeffs.length - 1;
            if (polyDegree >= 1 && polyDegree <= 3) {
                polyRoots = math.polynomialRoot(...coeffs);
            }
        }
    } catch (e) {
        isPolynomial = false;
    }

    if (polyRoots) {
        let latex = '\\begin{aligned}\n';
        latex += `${eqTex} \\\\\n`;
        latex += '\\implies ';
        const rootsStrList = polyRoots.map((r, idx) => {
            let rStr = '';
            if (typeof r === 'number') {
                rStr = Number(r.toFixed(8)).toString();
            } else if (r && r.isComplex) {
                const re = Number(r.re.toFixed(8)).toString();
                const im = Number(r.im.toFixed(8)).toString();
                if (Math.abs(r.im) < 1e-10) {
                    rStr = re;
                } else {
                    const sign = r.im >= 0 ? '+' : '-';
                    const imAbs = Math.abs(r.im);
                    const imStr = imAbs === 1 ? 'i' : `${Number(imAbs.toFixed(8)).toString()}i`;
                    rStr = `${re} ${sign} ${imStr}`;
                }
            } else {
                rStr = math.format(r, { precision: 8 });
            }
            return `${xVar}_{${idx + 1}} = ${rStr}`;
        });
        latex += rootsStrList.join(', \\quad ') + '\n\\end{aligned}';
        return { success: true, latex };
    }

    // Fallback: Numerical Newton-Raphson Solver
    const compiledF = E.compile();
    const f = (xVal) => {
        try {
            const res = compiledF.evaluate({ [xVar]: xVal });
            if (res && typeof res === 'object') {
                if (res.isComplex) return Math.abs(res.im) < 1e-10 ? res.re : NaN;
                return res.toNumber ? res.toNumber() : NaN;
            }
            return typeof res === 'number' ? res : NaN;
        } catch (err) {
            return NaN;
        }
    };

    let compiledDf = null;
    try {
        const D = math.derivative(E, xVar);
        compiledDf = D.compile();
    } catch (e) {}

    const df = (xVal) => {
        if (compiledDf) {
            try {
                const res = compiledDf.evaluate({ [xVar]: xVal });
                let val = NaN;
                if (res && typeof res === 'object') {
                    if (res.isComplex) val = Math.abs(res.im) < 1e-10 ? res.re : NaN;
                    else val = res.toNumber ? res.toNumber() : NaN;
                } else {
                    val = typeof res === 'number' ? res : NaN;
                }
                if (!isNaN(val) && isFinite(val)) return val;
            } catch (e) {}
        }
        
        // Numerical derivative fallback (finite differences)
        const h = 1e-7;
        const fPlus = f(xVal + h);
        const fMinus = f(xVal - h);
        if (!isNaN(fPlus) && !isNaN(fMinus)) {
            return (fPlus - fMinus) / (2 * h);
        }
        return NaN;
    };

    const candidates = [0, 1, -1, 0.5, -0.5, 2, -2, 5, -5, 10, -10];
    let foundConv = false;
    let history = [];
    let rootVal = null;

    for (const x0 of candidates) {
        let x = x0;
        history = [];
        let converged = false;
        
        for (let k = 0; k <= 30; k++) {
            const y = f(x);
            const dy = df(x);
            
            history.push({ step: k, x, fx: y, dfx: dy });
            
            if (isNaN(y) || isNaN(dy) || !isFinite(y) || !isFinite(dy)) {
                break;
            }
            
            if (Math.abs(y) < 1e-10) {
                converged = true;
                rootVal = x;
                break;
            }
            
            if (Math.abs(dy) < 1e-12) {
                break;
            }
            
            const nextX = x - y / dy;
            
            if (Math.abs(nextX - x) < 1e-12) {
                converged = true;
                rootVal = nextX;
                break;
            }
            
            x = nextX;
        }
        
        if (converged) {
            foundConv = true;
            break;
        }
    }

    if (foundConv) {
        let latex = '\\begin{aligned}\n';
        latex += `${eqTex} \\\\\n`;
        latex += `\\implies ${xVar} \\approx ${Number(rootVal.toFixed(10)).toString()}\n`;
        latex += '\\end{aligned}';
        return { success: true, latex };
    }

    return { success: false, error: 'Numerical solver could not converge to a root. Please verify if the equation has real roots.' };
}

async function solveOde(inputStr) {
    let remainder = inputStr.trim();
    let mode = 'hybrid';

    // 1. Parse mode flags
    if (remainder.startsWith('-s ') || remainder.startsWith('--sym ')) {
        mode = 'sym';
        remainder = remainder.replace(/^(--sym|-s)\s+/, '');
    } else if (remainder.startsWith('-n ') || remainder.startsWith('--num ')) {
        mode = 'num';
        remainder = remainder.replace(/^(--num|-n)\s+/, '');
    }

    let phaseAxes = null;
    const phaseMatch = remainder.match(/^(-p|--phase)\s+([a-zA-Z]+),([a-zA-Z]+)\s+/);
    if (phaseMatch) {
        phaseAxes = [phaseMatch[2], phaseMatch[3]];
        remainder = remainder.replace(phaseMatch[0], '');
    }

    // 2. Parse X and Y domains in brackets
    let xDomain = null;
    let yDomain = null;
    const rangeMatches = [...remainder.matchAll(/\[([^\]]+)\]/g)];
    if (rangeMatches.length > 0) {
        try {
            const parts = rangeMatches[0][1].split(',');
            const lo = math.evaluate(parts[0].trim());
            const hi = math.evaluate(parts[1].trim());
            if (!isNaN(lo) && !isNaN(hi) && isFinite(lo) && isFinite(hi) && lo < hi) xDomain = [lo, hi];
            remainder = remainder.replace(rangeMatches[0][0], '');
        } catch (e) {}
    }
    if (rangeMatches.length > 1) {
        try {
            const parts = rangeMatches[1][1].split(',');
            const lo = math.evaluate(parts[0].trim());
            const hi = math.evaluate(parts[1].trim());
            if (!isNaN(lo) && !isNaN(hi) && isFinite(lo) && isFinite(hi) && lo < hi) yDomain = [lo, hi];
            remainder = remainder.replace(rangeMatches[1][0], '');
        } catch (e) {}
    }

    remainder = remainder.trim();

    const xMin = xDomain ? xDomain[0] : null;
    const xMax = xDomain ? xDomain[1] : null;

    const payload = {
        text: remainder,
        mode: mode,
        x_min: xMin,
        x_max: xMax
    };
    if (phaseAxes) {
        payload.plot_axes = phaseAxes;
    }

    const pyScriptPath = path.join(__dirname, 'ode_solver.py');
    const response = await runSubprocess(pyScriptPath, payload);
    if (!response.success) {
        return response;
    }

    // If domains were resolved, attach them to the response
    if (phaseAxes) {
        if (response.curves && Object.keys(response.curves).length > 0) {
            const firstCurve = Object.values(response.curves)[0];
            if (firstCurve && firstCurve.length > 0) {
                const xValues = firstCurve.map(pt => pt.x).filter(v => v !== null && !isNaN(v) && isFinite(v));
                if (xValues.length > 0) {
                    const minVal = Math.min(...xValues);
                    const maxVal = Math.max(...xValues);
                    const range = maxVal - minVal;
                    const pad = Math.max(range * 0.15, 1.0); // 15% padding
                    response.xDomain = [minVal - pad, maxVal + pad];
                }
            }
        }
        if (!response.xDomain) {
            response.xDomain = [-10, 10];
        }
    } else {
        if (xDomain) {
            response.xDomain = xDomain;
        } else if (response.curves && Object.keys(response.curves).length > 0) {
            // Python calculates points in default range, extract min/max t from curves
            const firstCurve = Object.values(response.curves)[0];
            if (firstCurve && firstCurve.length > 0) {
                const tVals = firstCurve.map(pt => pt.x);
                response.xDomain = [Math.min(...tVals), Math.max(...tVals)];
            }
        }
    }

    if (yDomain) {
        response.yDomain = yDomain;
    }

    return response;
}

async function rearrangeEquation(inputStr) {
    const remainder = inputStr.trim();
    const match = remainder.match(/^([\s\S]+?)\bfor\b([\s\S]+)$/i);
    if (!match) {
        return {
            success: false,
            error: 'Invalid format. Use: !desp <equation> for <variable>\nExample: !desp E = m * c^2 for c'
        };
    }

    const equation = match[1].trim();
    const variable = match[2].trim();

    if (!equation) {
        return { success: false, error: 'No equation provided.' };
    }
    if (!variable) {
        return { success: false, error: 'No target variable provided.' };
    }

    // Validate variable name to prevent command/LaTeX injection
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(variable)) {
        return { success: false, error: 'Invalid variable name. It must be a simple alphanumeric name.' };
    }

    const payload = {
        equation: equation,
        variable: variable
    };

    const pyScriptPath = path.join(__dirname, 'rearrange_solver.py');
    return await runSubprocess(pyScriptPath, payload);
}

function splitTopLevel(str) {
    const parts = [];
    let current = '';
    let depth = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (char === '(' || char === '[' || char === '{') {
            depth++;
            current += char;
        } else if (char === ')' || char === ']' || char === '}') {
            depth--;
            current += char;
        } else if (char === ',' && depth === 0) {
            parts.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    parts.push(current.trim());
    return parts.filter(Boolean);
}

function parseDifferentiationInput(input) {
    let expr = '';
    let variable = '';

    input = input.trim();

    // Check comma separation
    if (input.includes(',')) {
        const parts = splitTopLevel(input);
        if (parts.length >= 2) {
            const potentialVar = parts[parts.length - 1];
            if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(potentialVar)) {
                variable = potentialVar;
                expr = parts.slice(0, parts.length - 1).join(',');
                return { expr, variable };
            }
        }
    }

    // Space-separated
    const tokens = input.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) {
        const potentialVar = tokens[tokens.length - 1];
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(potentialVar)) {
            variable = potentialVar;
            expr = tokens.slice(0, tokens.length - 1).join(' ');
            return { expr, variable };
        }
    }

    expr = input;
    return { expr, variable };
}

function parseIntegrationInput(input) {
    let expr = '';
    let variable = '';
    let lower = null;
    let upper = null;

    input = input.trim();

    // Check comma separation first
    if (input.includes(',')) {
        const parts = splitTopLevel(input);
        if (parts.length >= 4) {
            upper = parts[parts.length - 1];
            lower = parts[parts.length - 2];
            variable = parts[parts.length - 3];
            expr = parts.slice(0, parts.length - 3).join(',');
            return { expr, variable, lower, upper };
        } else if (parts.length === 2) {
            expr = parts[0];
            variable = parts[1];
            return { expr, variable, lower, upper };
        }
    }

    // Space-separated fallback
    const tokens = input.split(/\s+/).filter(Boolean);
    if (tokens.length >= 4) {
        const potentialVar = tokens[tokens.length - 3];
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(potentialVar)) {
            upper = tokens[tokens.length - 1];
            lower = tokens[tokens.length - 2];
            variable = potentialVar;
            expr = tokens.slice(0, tokens.length - 3).join(' ');
            return { expr, variable, lower, upper };
        }
    }
    
    if (tokens.length >= 2) {
        const potentialVar = tokens[tokens.length - 1];
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(potentialVar)) {
            variable = potentialVar;
            expr = tokens.slice(0, tokens.length - 1).join(' ');
            return { expr, variable, lower, upper };
        }
    }

    expr = input;
    return { expr, variable, lower, upper };
}

function runCalculusSubprocess(payload) {
    const pyScriptPath = path.join(__dirname, 'calculus_solver.py');
    return runSubprocess(pyScriptPath, payload);
}

function solveDerivative(inputStr) {
    const parsed = parseDifferentiationInput(inputStr);
    let exprStr = parsed.expr;
    let varStr = parsed.variable;

    if (!exprStr) {
        return Promise.resolve({ success: false, error: 'No expression provided for differentiation.' });
    }

    try {
        const node = math.parse(exprStr);
        let actualVarStr = varStr;
        if (!actualVarStr) {
            const vars = extractVariables(node);
            actualVarStr = vars.length === 1 ? vars[0] : 'x';
        }

        const derivativeNode = math.derivative(node, actualVarStr);
        const originalTex = node.toTex();
        const derivativeTex = derivativeNode.toTex();

        const latex = `\\begin{aligned}\n\\frac{d}{d${actualVarStr}}\\left(${originalTex}\\right) &= ${derivativeTex}\n\\end{aligned}`;
        return Promise.resolve({ success: true, latex });
    } catch (err) {
        console.log(`mathjs derivative failed, falling back to SymPy... Error: ${err.message}`);
        return runCalculusSubprocess({
            operation: 'diff',
            expr: exprStr,
            variable: varStr
        });
    }
}

function solveIntegral(inputStr) {
    const parsed = parseIntegrationInput(inputStr);
    let exprStr = parsed.expr;
    let varStr = parsed.variable;
    let lower = parsed.lower;
    let upper = parsed.upper;

    if (!exprStr) {
        return Promise.resolve({ success: false, error: 'No expression provided for integration.' });
    }

    return runCalculusSubprocess({
        operation: 'int',
        expr: exprStr,
        variable: varStr,
        lower: lower,
        upper: upper
    });
}

module.exports = {
    solveEquation,
    solveOde,
    rearrangeEquation,
    solveDerivative,
    solveIntegral
};

