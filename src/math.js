const { create, all } = require('mathjs');
const { splitTopLevel } = require('./utils');
const {
    LINE_PARAM_PREFERENCES,
    SURFACE_PARAM_PREFERENCES,
    extractInlineDependencies,
    inferParameterNames,
    parseDerivativeCall,
    parseIntegralCall,
    parseTupleSource
} = require('./inline-calculus');
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

const inlineExpressionCache = new Map();
const inlineDerivativeCache = new Map();
const inlineIntegralCache = new Map();

function extractVarsFromSource(source) {
    try {
        const vars = new Set();
        math.parse(String(source || '')).traverse((child, path, parent) => {
            if (!child || !child.isSymbolNode) {
                return;
            }

            if (parent && parent.isFunctionNode && parent.fn === child) {
                return;
            }

            const name = child.name;
            const ignored = ['pi', 'e', 'i', 'true', 'false', 'NaN', 'null', 'Infinity'];
            if (!name || ignored.includes(name) || math[name]) {
                return;
            }

            vars.add(name);
        });
        return Array.from(vars);
    } catch (_) {
        return [];
    }
}

function buildInlineArgDescriptors(args) {
    return (args || []).map((arg) => ({
        kind: (arg && typeof arg.value === 'string') ? 'string' : 'expr',
        source: String(getRawExpressionSource(arg) || ''),
        node: arg
    }));
}

function buildInlineCallKey(functionName, descriptors) {
    return `${functionName}|${descriptors.map((descriptor) => `${descriptor.kind}:${descriptor.source}`).join('|')}`;
}

function compileInlineExpression(source) {
    const key = String(source || '').trim();
    if (!inlineExpressionCache.has(key)) {
        inlineExpressionCache.set(key, math.compile(key));
    }
    return inlineExpressionCache.get(key);
}

function evaluateCompiledReal(compiled, scope, label) {
    const numericValue = normalizeNumericValue(compiled.evaluate(scope));
    if (typeof numericValue !== 'number' || Number.isNaN(numericValue)) {
        throw new Error(`${label} did not evaluate to a real number.`);
    }
    return numericValue;
}

function evaluateSourceReal(source, scope, label) {
    return evaluateCompiledReal(compileInlineExpression(source), scope, label);
}

function evaluateCompiledTuple(compiledEntries, scope, label) {
    return compiledEntries.map((compiled, index) => {
        const numericValue = normalizeNumericValue(compiled.evaluate(scope));
        if (typeof numericValue !== 'number' || Number.isNaN(numericValue)) {
            throw new Error(`${label} component ${index + 1} did not evaluate to a real number.`);
        }
        return numericValue;
    });
}

function finiteDifferenceStep(value) {
    const magnitude = Math.max(1, Math.abs(Number(value) || 0));
    return 1e-4 * magnitude;
}

function getScopeValue(scope, name) {
    if (scope && typeof scope.get === 'function') {
        return scope.get(name);
    }
    if (scope && typeof scope === 'object') {
        return scope[name];
    }
    return undefined;
}

function applyDerivativeEvaluationBindings(config, scope) {
    const localScope = cloneScope(scope);

    for (const assignment of config.atAssignments || []) {
        localScope.set(
            assignment.name,
            evaluateSourceReal(assignment.exprSource, localScope, `deriv at:${assignment.name}`)
        );
    }

    const uniqueVariables = config.uniqueVariables || [];
    if ((config.positionalEvalSources || []).length > 0) {
        uniqueVariables.forEach((name, index) => {
            localScope.set(
                name,
                evaluateSourceReal(config.positionalEvalSources[index], localScope, `deriv positional argument ${index + 1}`)
            );
        });
    }

    return localScope;
}

function evaluateNumericDerivative(compiled, scope, sequence, index = 0) {
    if (index >= sequence.length) {
        return evaluateCompiledReal(compiled, scope, 'deriv');
    }

    const varName = sequence[index];
    const center = normalizeNumericValue(getScopeValue(scope, varName));
    if (typeof center !== 'number' || Number.isNaN(center)) {
        throw new Error(`deriv requires a numeric value for "${varName}" at evaluation time.`);
    }

    const step = finiteDifferenceStep(center);
    const plusScope = cloneScope(scope);
    plusScope.set(varName, center + step);
    const minusScope = cloneScope(scope);
    minusScope.set(varName, center - step);

    return (
        evaluateNumericDerivative(compiled, plusScope, sequence, index + 1) -
        evaluateNumericDerivative(compiled, minusScope, sequence, index + 1)
    ) / (2 * step);
}

function simpsonIntegrate(fn, lower, upper, steps = 96) {
    if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
        throw new Error('Inline numeric integration requires finite bounds.');
    }
    if (Math.abs(upper - lower) < 1e-12) {
        return 0;
    }

    let a = lower;
    let b = upper;
    let sign = 1;
    if (b < a) {
        sign = -1;
        a = upper;
        b = lower;
    }

    let n = Math.max(8, Math.floor(steps));
    if (n % 2 !== 0) {
        n += 1;
    }

    const h = (b - a) / n;
    let sum = fn(a) + fn(b);

    for (let index = 1; index < n; index++) {
        const x = a + index * h;
        sum += (index % 2 === 0 ? 2 : 4) * fn(x);
    }

    return sign * sum * h / 3;
}

function chooseIntegrationSteps(mode, dimension) {
    if (mode === 'line') {
        return 120;
    }
    if (mode === 'surface') {
        return 28;
    }
    if (mode === 'volume') {
        return 14;
    }
    if (dimension <= 1) {
        return 96;
    }
    if (dimension === 2) {
        return 28;
    }
    return 14;
}

function crossProduct(a, b) {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
}

function magnitude(vector) {
    return Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));
}

function dotProduct(a, b) {
    return a.reduce((sum, value, index) => sum + (value * b[index]), 0);
}

function evaluateIteratedIntegral(ranges, terminalEvaluator, scope, mode = 'standard') {
    const steps = chooseIntegrationSteps(mode, ranges.length);

    function recurse(level, localScope) {
        if (level >= ranges.length) {
            return terminalEvaluator(localScope);
        }

        const range = ranges[level];
        const lower = evaluateSourceReal(range.lowerSource, localScope, `${mode} lower bound for ${range.name}`);
        const upper = evaluateSourceReal(range.upperSource, localScope, `${mode} upper bound for ${range.name}`);

        return simpsonIntegrate((value) => {
            const nextScope = cloneScope(localScope);
            nextScope.set(range.name, value);
            return recurse(level + 1, nextScope);
        }, lower, upper, steps);
    }

    return recurse(0, cloneScope(scope));
}

function buildDerivativeHelperData(descriptors) {
    const parsed = parseDerivativeCall(descriptors, extractVarsFromSource);
    if (!parsed.success) {
        throw new Error(parsed.error);
    }

    const dependencyNames = extractInlineDependencies('deriv', descriptors, extractVarsFromSource);
    const exprNode = math.parse(parsed.exprSource);
    let symbolicNode = exprNode;
    let symbolicCompiled = null;

    try {
        for (const variableName of parsed.sequence) {
            symbolicNode = math.simplify(math.derivative(symbolicNode, variableName));
        }
        symbolicCompiled = symbolicNode.compile();
    } catch (_) {
        symbolicNode = null;
        symbolicCompiled = null;
    }

    return {
        parsed,
        dependencyNames,
        baseCompiled: exprNode.compile(),
        symbolicNode,
        symbolicCompiled,
        constantValue: undefined,
        hasConstantValue: false
    };
}

function buildIntegralHelperData(descriptors) {
    const parsed = parseIntegralCall(descriptors, extractVarsFromSource);
    if (!parsed.success) {
        throw new Error(parsed.error);
    }

    const dependencyNames = extractInlineDependencies('integ', descriptors, extractVarsFromSource);

    if (parsed.mode === 'line') {
        if (!parsed.paramSource) {
            throw new Error('integ kind:line requires param:{...}.');
        }
        if ((parsed.ranges || []).length !== 1) {
            throw new Error('integ kind:line requires exactly one parameter range.');
        }

        const pathComponents = parseTupleSource(parsed.paramSource);
        if (pathComponents.length !== 2 && pathComponents.length !== 3) {
            throw new Error('Line-integral parametrizations must have 2 or 3 components.');
        }

        const fieldComponents = parseTupleSource(parsed.exprSource);
        const isVectorField = fieldComponents.length === pathComponents.length;
        const paramNames = inferParameterNames(
            parsed.paramSource,
            1,
            parsed.ranges.map((range) => range.name),
            extractVarsFromSource,
            LINE_PARAM_PREFERENCES
        );
        if (paramNames.length !== 1) {
            throw new Error('Could not determine the line-integral parameter variable.');
        }

        return {
            parsed,
            dependencyNames,
            pathCompilers: pathComponents.map((source) => compileInlineExpression(source)),
            fieldCompilers: isVectorField
                ? fieldComponents.map((source) => compileInlineExpression(source))
                : [compileInlineExpression(parsed.exprSource)],
            isVectorField,
            paramNames,
            constantValue: undefined,
            hasConstantValue: false
        };
    }

    if (parsed.mode === 'surface') {
        if (!parsed.paramSource) {
            throw new Error('integ kind:surface requires param:{...}.');
        }
        if ((parsed.ranges || []).length !== 2) {
            throw new Error('integ kind:surface requires exactly two parameter ranges.');
        }

        const surfaceComponents = parseTupleSource(parsed.paramSource);
        if (surfaceComponents.length !== 3) {
            throw new Error('Surface-integral parametrizations must have exactly 3 components.');
        }

        const fieldComponents = parseTupleSource(parsed.exprSource);
        const isVectorField = fieldComponents.length === 3;
        const paramNames = inferParameterNames(
            parsed.paramSource,
            2,
            parsed.ranges.map((range) => range.name),
            extractVarsFromSource,
            SURFACE_PARAM_PREFERENCES
        );
        if (paramNames.length !== 2) {
            throw new Error('Could not determine the surface parameters.');
        }

        return {
            parsed,
            dependencyNames,
            surfaceCompilers: surfaceComponents.map((source) => compileInlineExpression(source)),
            fieldCompilers: isVectorField
                ? fieldComponents.map((source) => compileInlineExpression(source))
                : [compileInlineExpression(parsed.exprSource)],
            isVectorField,
            paramNames,
            constantValue: undefined,
            hasConstantValue: false
        };
    }

    const standardRanges = (parsed.ranges && parsed.ranges.length > 0)
        ? parsed.ranges
        : parsed.antiderivativeRanges;
    if (!standardRanges || standardRanges.length === 0) {
        throw new Error('integ requires at least one integration variable or range.');
    }

    return {
        parsed,
        dependencyNames,
        compiledExpr: compileInlineExpression(parsed.exprSource),
        ranges: standardRanges,
        constantValue: undefined,
        hasConstantValue: false
    };
}

function getDerivativeHelperData(args) {
    const descriptors = buildInlineArgDescriptors(args);
    const key = buildInlineCallKey('deriv', descriptors);
    if (!inlineDerivativeCache.has(key)) {
        inlineDerivativeCache.set(key, buildDerivativeHelperData(descriptors));
    }
    return inlineDerivativeCache.get(key);
}

function getIntegralHelperData(args) {
    const descriptors = buildInlineArgDescriptors(args);
    const key = buildInlineCallKey('integ', descriptors);
    if (!inlineIntegralCache.has(key)) {
        inlineIntegralCache.set(key, buildIntegralHelperData(descriptors));
    }
    return inlineIntegralCache.get(key);
}

function evaluateDerivativeHelper(data, scope) {
    if (data.dependencyNames.length === 0 && data.hasConstantValue) {
        return data.constantValue;
    }

    const localScope = applyDerivativeEvaluationBindings(data.parsed, scope);
    const value = data.symbolicCompiled
        ? evaluateCompiledReal(data.symbolicCompiled, localScope, 'deriv')
        : evaluateNumericDerivative(data.baseCompiled, localScope, data.parsed.sequence);

    if (data.dependencyNames.length === 0) {
        data.constantValue = value;
        data.hasConstantValue = true;
    }

    return value;
}

function evaluateStandardIntegralHelper(data, scope) {
    return evaluateIteratedIntegral(
        data.ranges,
        (localScope) => evaluateCompiledReal(data.compiledExpr, localScope, 'integ'),
        scope,
        data.parsed.mode
    );
}

function evaluateLineIntegralHelper(data, scope) {
    const paramName = data.paramNames[0];
    const range = data.parsed.ranges[0];
    const steps = chooseIntegrationSteps('line', 1);
    const baseScope = cloneScope(scope);
    const lower = evaluateSourceReal(range.lowerSource, baseScope, `line lower bound for ${paramName}`);
    const upper = evaluateSourceReal(range.upperSource, baseScope, `line upper bound for ${paramName}`);

    const evaluatePath = (paramValue) => {
        const localScope = cloneScope(baseScope);
        localScope.set(paramName, paramValue);
        return evaluateCompiledTuple(data.pathCompilers, localScope, 'line path');
    };

    const integrand = (paramValue) => {
        const step = finiteDifferenceStep(paramValue);
        const pathValue = evaluatePath(paramValue);
        const tangent = pathValue.map((_, index) => {
            const plus = evaluatePath(paramValue + step)[index];
            const minus = evaluatePath(paramValue - step)[index];
            return (plus - minus) / (2 * step);
        });

        const coordScope = cloneScope(baseScope);
        coordScope.set(paramName, paramValue);
        coordScope.set('x', pathValue[0]);
        coordScope.set('y', pathValue[1]);
        if (pathValue.length === 3) {
            coordScope.set('z', pathValue[2]);
        }

        if (data.isVectorField) {
            const fieldValue = evaluateCompiledTuple(data.fieldCompilers, coordScope, 'line field');
            return dotProduct(fieldValue, tangent);
        }

        const scalarField = evaluateCompiledReal(data.fieldCompilers[0], coordScope, 'line scalar field');
        return scalarField * magnitude(tangent);
    };

    return simpsonIntegrate(integrand, lower, upper, steps);
}

function evaluateSurfaceIntegralHelper(data, scope) {
    const [firstParam, secondParam] = data.paramNames;
    const steps = chooseIntegrationSteps('surface', 2);
    const baseScope = cloneScope(scope);

    const evaluateSurfacePoint = (uValue, vValue) => {
        const localScope = cloneScope(baseScope);
        localScope.set(firstParam, uValue);
        localScope.set(secondParam, vValue);
        return evaluateCompiledTuple(data.surfaceCompilers, localScope, 'surface parametrization');
    };

    const integrandAt = (uValue, vValue) => {
        const stepU = finiteDifferenceStep(uValue);
        const stepV = finiteDifferenceStep(vValue);
        const point = evaluateSurfacePoint(uValue, vValue);

        const plusU = evaluateSurfacePoint(uValue + stepU, vValue);
        const minusU = evaluateSurfacePoint(uValue - stepU, vValue);
        const plusV = evaluateSurfacePoint(uValue, vValue + stepV);
        const minusV = evaluateSurfacePoint(uValue, vValue - stepV);

        const rU = point.map((_, index) => (plusU[index] - minusU[index]) / (2 * stepU));
        const rV = point.map((_, index) => (plusV[index] - minusV[index]) / (2 * stepV));
        const normal = crossProduct(rU, rV);

        const coordScope = cloneScope(baseScope);
        coordScope.set(firstParam, uValue);
        coordScope.set(secondParam, vValue);
        coordScope.set('x', point[0]);
        coordScope.set('y', point[1]);
        coordScope.set('z', point[2]);

        if (data.isVectorField) {
            const fieldValue = evaluateCompiledTuple(data.fieldCompilers, coordScope, 'surface field');
            return dotProduct(fieldValue, normal);
        }

        const scalarField = evaluateCompiledReal(data.fieldCompilers[0], coordScope, 'surface scalar field');
        return scalarField * magnitude(normal);
    };

    const outerRange = data.parsed.ranges.find((range) => range.name === firstParam) || data.parsed.ranges[0];
    const innerRange = data.parsed.ranges.find((range) => range.name === secondParam) || data.parsed.ranges[1];

    const outerLower = evaluateSourceReal(outerRange.lowerSource, baseScope, `surface lower bound for ${firstParam}`);
    const outerUpper = evaluateSourceReal(outerRange.upperSource, baseScope, `surface upper bound for ${firstParam}`);

    return simpsonIntegrate((uValue) => {
        const uScope = cloneScope(baseScope);
        uScope.set(firstParam, uValue);
        const innerLower = evaluateSourceReal(innerRange.lowerSource, uScope, `surface lower bound for ${secondParam}`);
        const innerUpper = evaluateSourceReal(innerRange.upperSource, uScope, `surface upper bound for ${secondParam}`);
        return simpsonIntegrate((vValue) => integrandAt(uValue, vValue), innerLower, innerUpper, steps);
    }, outerLower, outerUpper, steps);
}

function evaluateIntegralHelper(data, scope) {
    if (data.dependencyNames.length === 0 && data.hasConstantValue) {
        return data.constantValue;
    }

    let value;
    if (data.parsed.mode === 'line') {
        value = evaluateLineIntegralHelper(data, scope);
    } else if (data.parsed.mode === 'surface') {
        value = evaluateSurfaceIntegralHelper(data, scope);
    } else {
        value = evaluateStandardIntegralHelper(data, scope);
    }

    if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new Error('integ did not evaluate to a real number.');
    }

    if (data.dependencyNames.length === 0) {
        data.constantValue = value;
        data.hasConstantValue = true;
    }

    return value;
}

function buildDerivativeTexFromConfig(config) {
    const innerTex = formatExpressionTex(config.exprSource);
    const totalOrder = config.sequence.length;

    if (config.recipe.length === 1) {
        const variable = config.recipe[0];
        if (variable.order === 1) {
            return `\\frac{d}{d${variable.name}}\\left(${innerTex}\\right)`;
        }
        return `\\frac{d^{${variable.order}}}{d${variable.name}^{${variable.order}}}\\left(${innerTex}\\right)`;
    }

    const denominator = config.recipe.map((entry) => (
        entry.order === 1 ? `\\partial ${entry.name}` : `\\partial ${entry.name}^{${entry.order}}`
    )).join(' ');

    return `\\frac{\\partial^{${totalOrder}}}{${denominator}}\\left(${innerTex}\\right)`;
}

function buildStandardIntegralTex(ranges, innerTex) {
    let tex = innerTex;
    for (let index = ranges.length - 1; index >= 0; index--) {
        const range = ranges[index];
        const lowerTex = formatExpressionTex(range.lowerSource);
        const upperTex = formatExpressionTex(range.upperSource);
        tex = `\\int_{${lowerTex}}^{${upperTex}} ${tex}\\, d${range.name}`;
    }
    return tex;
}

function buildIntegralTexFromConfig(config) {
    const vectorParts = parseTupleSource(config.exprSource);
    const isVector = vectorParts.length >= 2 && vectorParts.length <= 3;
    const innerTex = isVector ? formatVectorTex(config.exprSource) : formatExpressionTex(config.exprSource);

    if (config.mode === 'line') {
        return isVector ? `\\int_C ${innerTex} \\cdot d\\mathbf{r}` : `\\int_C ${innerTex}\\, ds`;
    }
    if (config.mode === 'surface') {
        return isVector ? `\\iint_S ${innerTex} \\cdot d\\mathbf{S}` : `\\iint_S ${innerTex}\\, dS`;
    }
    if (config.mode === 'volume') {
        return `\\iiint_V ${innerTex}\\, dV`;
    }

    const ranges = (config.ranges && config.ranges.length > 0) ? config.ranges : config.antiderivativeRanges;
    return buildStandardIntegralTex(ranges, innerTex);
}

const deriv = function (args, math, scope) {
    const helperData = getDerivativeHelperData(args);
    return evaluateDerivativeHelper(helperData, scope);
};
deriv.rawArgs = true;

deriv.toTex = function (node, options) {
    try {
        const parsed = parseDerivativeCall(buildInlineArgDescriptors(node.args), extractVarsFromSource);
        if (!parsed.success) {
            return `\\operatorname{deriv}\\left(${node.args.map((arg) => arg.toTex(options)).join(', ')}\\right)`;
        }
        return buildDerivativeTexFromConfig(parsed);
    } catch (_) {
        return `\\operatorname{deriv}\\left(${node.args.map((arg) => arg.toTex(options)).join(', ')}\\right)`;
    }
};

const integ = function (args, math, scope) {
    const helperData = getIntegralHelperData(args);
    return evaluateIntegralHelper(helperData, scope);
};
integ.rawArgs = true;

integ.toTex = function (node, options) {
    try {
        const parsed = parseIntegralCall(buildInlineArgDescriptors(node.args), extractVarsFromSource);
        if (!parsed.success) {
            return `\\operatorname{integ}\\left(${node.args.map((arg) => arg.toTex(options)).join(', ')}\\right)`;
        }
        return buildIntegralTexFromConfig(parsed);
    } catch (_) {
        return `\\operatorname{integ}\\left(${node.args.map((arg) => arg.toTex(options)).join(', ')}\\right)`;
    }
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
