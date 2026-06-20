const { create, all } = require('mathjs');
const math = create(all);

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

module.exports = math;
