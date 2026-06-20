const math = require('../math');

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

module.exports = {
    solveEquation,
    extractVariables,
    formatVal
};
