const { create, all } = require('mathjs');
const { splitTopLevel } = require('./utils');
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


function cloneScope(scope) {
    const localScope = new Map();
    if (scope && typeof scope.forEach === 'function') {
        scope.forEach((value, key) => {
            localScope.set(key, value);
        });
    } else if (scope && typeof scope === 'object') {
        Object.keys(scope).forEach((key) => {
            localScope.set(key, scope[key]);
        });
    }
    return localScope;
}

function normalizeNumericValue(value) {
    if (typeof value === 'number') {
        return value;
    }
    if (value && typeof value === 'object') {
        if (value.isComplex) {
            if (Math.abs(value.im) < 1e-10) {
                return value.re;
            }
            return NaN;
        }
        if (typeof value.toNumber === 'function') {
            return value.toNumber();
        }
        if (typeof value.valueOf === 'function') {
            const primitive = value.valueOf();
            if (typeof primitive === 'number') {
                return primitive;
            }
        }
    }
    return Number(value);
}

function getRawExpressionSource(node) {
    if (node && typeof node.value === 'string') {
        return node.value;
    }
    return node.toString();
}

function formatExpressionTex(source) {
    try {
        return math.parse(source).toTex();
    } catch (err) {
        return source;
    }
}

function parseVectorSource(source) {
    const trimmed = String(source || '').trim();
    if (!trimmed) {
        throw new Error('Vector field expression cannot be empty.');
    }

    let inner = trimmed;
    if (
        (trimmed.startsWith('(') && trimmed.endsWith(')')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
        inner = trimmed.slice(1, -1).trim();
    }

    const components = splitTopLevel(inner);
    if (components.length < 2 || components.length > 3) {
        throw new Error('Vector inline helpers only support 2D or 3D fields.');
    }

    return components;
}

function formatVectorTex(source) {
    try {
        const components = parseVectorSource(source);
        return `\\left\\langle ${components.map((component) => formatExpressionTex(component)).join(', ')} \\right\\rangle`;
    } catch (err) {
        return source;
    }
}

function parseInlineBindings(functionName, args, scope) {
    if (args.length < 2 || args.length > 4) {
        throw new Error(`${functionName} expects an expression followed by 1 to 3 coordinate symbols.`);
    }

    const exprSource = String(getRawExpressionSource(args[0] || '')).trim();
    if (!exprSource) {
        throw new Error(`${functionName} requires a non-empty expression.`);
    }

    const localScope = cloneScope(scope);
    const symbolNodes = args.slice(1);
    const varNames = symbolNodes.map((node) => {
        if (!node || !node.isSymbolNode) {
            throw new Error(`${functionName} expects coordinate symbols like x, y, or z after the expression.`);
        }
        return node.name;
    });

    if (new Set(varNames).size !== varNames.length) {
        throw new Error(`${functionName} coordinate symbols must be unique.`);
    }

    symbolNodes.forEach((node) => {
        localScope.set(node.name, node.compile().evaluate(scope));
    });

    return { exprSource, varNames, localScope };
}

const vectorInlineCache = new Map();

function getCachedVectorInline(key, builder) {
    if (!vectorInlineCache.has(key)) {
        vectorInlineCache.set(key, builder());
    }
    return vectorInlineCache.get(key);
}

function buildGradientData(exprSource, varNames) {
    return getCachedVectorInline(`grad|${exprSource}|${varNames.join(',')}`, () => {
        const exprNode = math.parse(exprSource);
        const nodes = varNames.map((name) => math.simplify(math.derivative(exprNode, name)));
        return {
            nodes,
            compiled: nodes.map((node) => node.compile())
        };
    });
}

function buildLaplacianData(exprSource, varNames) {
    return getCachedVectorInline(`lap|${exprSource}|${varNames.join(',')}`, () => {
        const exprNode = math.parse(exprSource);
        const secondDerivativeNodes = varNames.map((name) => {
            const firstDerivative = math.derivative(exprNode, name);
            return math.simplify(math.derivative(firstDerivative, name));
        });
        const node = math.simplify(secondDerivativeNodes.map((entry) => `(${entry.toString()})`).join(' + '));
        return {
            node,
            compiled: node.compile()
        };
    });
}

function buildDivergenceData(fieldSource, varNames) {
    return getCachedVectorInline(`div|${fieldSource}|${varNames.join(',')}`, () => {
        const components = parseVectorSource(fieldSource);
        if (components.length !== varNames.length) {
            throw new Error(`Divergence expects ${varNames.length} vector component(s) for ${varNames.join(', ')}.`);
        }

        const derivativeNodes = components.map((component, index) => {
            const componentNode = math.parse(component);
            return math.simplify(math.derivative(componentNode, varNames[index]));
        });
        const node = math.simplify(derivativeNodes.map((entry) => `(${entry.toString()})`).join(' + '));
        return {
            node,
            compiled: node.compile(),
            dimension: components.length
        };
    });
}

function buildCurlData(fieldSource, varNames) {
    return getCachedVectorInline(`curl|${fieldSource}|${varNames.join(',')}`, () => {
        const components = parseVectorSource(fieldSource);
        if (components.length !== varNames.length) {
            throw new Error(`Curl expects ${components.length} coordinate symbol(s) for this vector field.`);
        }

        const nodes = components.map((component) => math.parse(component));

        if (components.length === 2) {
            const scalarNode = math.simplify(
                `(${math.derivative(nodes[1], varNames[0]).toString()}) - (${math.derivative(nodes[0], varNames[1]).toString()})`
            );
            return {
                dimension: 2,
                scalarNode,
                compiled: scalarNode.compile()
            };
        }

        const curlNodes = [
            math.simplify(`(${math.derivative(nodes[2], varNames[1]).toString()}) - (${math.derivative(nodes[1], varNames[2]).toString()})`),
            math.simplify(`(${math.derivative(nodes[0], varNames[2]).toString()}) - (${math.derivative(nodes[2], varNames[0]).toString()})`),
            math.simplify(`(${math.derivative(nodes[1], varNames[0]).toString()}) - (${math.derivative(nodes[0], varNames[1]).toString()})`)
        ];

        return {
            dimension: 3,
            nodes: curlNodes,
            compiled: curlNodes.map((node) => node.compile())
        };
    });
}

function evaluateCompiledScalar(compiled, scope) {
    return normalizeNumericValue(compiled.evaluate(scope));
}

function evaluateCompiledVector(compiledEntries, scope) {
    return compiledEntries.map((compiled) => normalizeNumericValue(compiled.evaluate(scope)));
}

const grad = function (args, math, scope) {
    const { exprSource, varNames, localScope } = parseInlineBindings('grad', args, scope);
    const gradientData = buildGradientData(exprSource, varNames);
    return evaluateCompiledVector(gradientData.compiled, localScope);
};
grad.rawArgs = true;
grad.toTex = function (node, options) {
    const exprTex = formatExpressionTex(getRawExpressionSource(node.args[0]));
    return `\\nabla\\left(${exprTex}\\right)`;
};

function makeGradientComponentHelper(componentIndex, label) {
    const helper = function (args, math, scope) {
        const { exprSource, varNames, localScope } = parseInlineBindings(label, args, scope);
        if (componentIndex >= varNames.length) {
            throw new Error(`${label} requires at least ${componentIndex + 1} coordinate symbols.`);
        }
        const gradientData = buildGradientData(exprSource, varNames);
        return evaluateCompiledScalar(gradientData.compiled[componentIndex], localScope);
    };
    helper.rawArgs = true;
    helper.toTex = function (node, options) {
        const exprTex = formatExpressionTex(getRawExpressionSource(node.args[0]));
        const varNode = node.args[componentIndex + 1];
        const varTex = varNode ? varNode.toTex(options) : `x_${componentIndex + 1}`;
        return `\\frac{\\partial}{\\partial ${varTex}}\\left(${exprTex}\\right)`;
    };
    return helper;
}

const gradx = makeGradientComponentHelper(0, 'gradx');
const grady = makeGradientComponentHelper(1, 'grady');
const gradz = makeGradientComponentHelper(2, 'gradz');

const lap = function (args, math, scope) {
    const { exprSource, varNames, localScope } = parseInlineBindings('lap', args, scope);
    const laplacianData = buildLaplacianData(exprSource, varNames);
    return evaluateCompiledScalar(laplacianData.compiled, localScope);
};
lap.rawArgs = true;
lap.toTex = function (node, options) {
    const exprTex = formatExpressionTex(getRawExpressionSource(node.args[0]));
    return `\\nabla^{2}\\left(${exprTex}\\right)`;
};

const div = function (args, math, scope) {
    const { exprSource, varNames, localScope } = parseInlineBindings('div', args, scope);
    const divergenceData = buildDivergenceData(exprSource, varNames);
    return evaluateCompiledScalar(divergenceData.compiled, localScope);
};
div.rawArgs = true;
div.toTex = function (node, options) {
    const fieldTex = formatVectorTex(getRawExpressionSource(node.args[0]));
    return `\\nabla \\cdot ${fieldTex}`;
};

const curl = function (args, math, scope) {
    const { exprSource, varNames, localScope } = parseInlineBindings('curl', args, scope);
    const curlData = buildCurlData(exprSource, varNames);
    if (curlData.dimension === 2) {
        return evaluateCompiledScalar(curlData.compiled, localScope);
    }
    return evaluateCompiledVector(curlData.compiled, localScope);
};
curl.rawArgs = true;
curl.toTex = function (node, options) {
    const fieldTex = formatVectorTex(getRawExpressionSource(node.args[0]));
    return `\\nabla \\times ${fieldTex}`;
};

function makeCurlComponentHelper(componentIndex, label) {
    const helper = function (args, math, scope) {
        const { exprSource, varNames, localScope } = parseInlineBindings(label, args, scope);
        const curlData = buildCurlData(exprSource, varNames);

        if (curlData.dimension !== 3) {
            throw new Error(`${label} only applies to 3D vector fields.`);
        }

        return evaluateCompiledScalar(curlData.compiled[componentIndex], localScope);
    };
    helper.rawArgs = true;
    helper.toTex = function (node, options) {
        const fieldTex = formatVectorTex(getRawExpressionSource(node.args[0]));
        const basis = ['x', 'y', 'z'][componentIndex];
        return `\\left(\\nabla \\times ${fieldTex}\\right)_{${basis}}`;
    };
    return helper;
}

const curlx = makeCurlComponentHelper(0, 'curlx');
const curly = makeCurlComponentHelper(1, 'curly');
const curlz = makeCurlComponentHelper(2, 'curlz');

const deriv = function (args, math, scope) {
    const exprStr = args[0].compile().evaluate(scope);
    const varName = args[1].compile().evaluate(scope);
    const val = args[2].compile().evaluate(scope);

    const derivativeNode = math.derivative(exprStr, varName);

    const localScope = cloneScope(scope);
    localScope.set(varName, val);

    return derivativeNode.evaluate(localScope);
};
deriv.rawArgs = true;

deriv.toTex = function (node, options) {
    const exprStr = node.args[0].value;
    const varStr = node.args[1].value;
    const innerTex = math.parse(exprStr).toTex();
    return `\\frac{d}{d${varStr}}\\left(${innerTex}\\right)`;
};

const integ = function (args, math, scope) {
    const exprStr = args[0].compile().evaluate(scope);
    const varName = args[1].compile().evaluate(scope);
    const lower = args[2].compile().evaluate(scope);
    const upper = args[3].compile().evaluate(scope);

    const compiled = math.compile(exprStr);

    const localScope = cloneScope(scope);

    const f = (val) => {
        localScope.set(varName, val);
        return compiled.evaluate(localScope);
    };

    const n = 100;
    const h = (upper - lower) / n;
    let sum = 0.5 * (f(lower) + f(upper));
    for (let i = 1; i < n; i++) {
        sum += f(lower + i * h);
    }
    return sum * h;
};
integ.rawArgs = true;

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
    grad,
    gradx,
    grady,
    gradz,
    div,
    curl,
    curlx,
    curly,
    curlz,
    lap,
    deriv,
    integ,
    factorial,
    polygamma
}, { override: true });

module.exports = math;
