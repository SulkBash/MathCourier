const { splitTopLevel } = require('./utils');

const VALID_VAR_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const COORDINATE_NAMES = new Set(['x', 'y', 'z']);
const LINE_PARAM_PREFERENCES = ['t', 's', 'tau', 'theta', 'u', 'v'];
const SURFACE_PARAM_PREFERENCES = ['u', 'v', 's', 't', 'theta', 'phi', 'r', 'w'];
const VECTOR_VAR_PREFERENCES = ['x', 'y', 'z', 'r', 'theta', 'phi', 'u', 'v', 'w', 's', 't'];
const SCALAR_VECTOR_INLINE_HELPERS = new Set(['grad', 'gradx', 'grady', 'gradz', 'lap']);
const VECTOR_FIELD_INLINE_HELPERS = new Set(['div', 'curl', 'curlx', 'curly', 'curlz']);
const VECTOR_INLINE_HELPERS = new Set([
    ...SCALAR_VECTOR_INLINE_HELPERS,
    ...VECTOR_FIELD_INLINE_HELPERS
]);

function unique(items = []) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
        const value = String(item || '').trim();
        if (!value || seen.has(value)) {
            continue;
        }
        seen.add(value);
        out.push(value);
    }
    return out;
}

function findTopLevelColon(text) {
    const source = String(text || '');
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let inQuotes = false;
    let quoteChar = null;

    for (let index = 0; index < source.length; index++) {
        const char = source[index];

        if (inQuotes) {
            if (char === '\\' && index + 1 < source.length) {
                index++;
                continue;
            }
            if (char === quoteChar) {
                inQuotes = false;
                quoteChar = null;
            }
            continue;
        }

        if (char === '"' || char === '\'') {
            inQuotes = true;
            quoteChar = char;
            continue;
        }

        if (char === '(') {
            parenDepth++;
            continue;
        }
        if (char === ')') {
            parenDepth = Math.max(0, parenDepth - 1);
            continue;
        }
        if (char === '[') {
            bracketDepth++;
            continue;
        }
        if (char === ']') {
            bracketDepth = Math.max(0, bracketDepth - 1);
            continue;
        }
        if (char === '{') {
            braceDepth++;
            continue;
        }
        if (char === '}') {
            braceDepth = Math.max(0, braceDepth - 1);
            continue;
        }

        if (char === ':' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
            return index;
        }
    }

    return -1;
}

function parseOptionToken(text) {
    const source = String(text || '').trim();
    const colonIndex = findTopLevelColon(source);
    if (colonIndex === -1) {
        return null;
    }

    const key = source.slice(0, colonIndex).trim().toLowerCase();
    const rawValue = source.slice(colonIndex + 1).trim();
    if (!VALID_VAR_RE.test(key) || !rawValue) {
        return null;
    }

    if (rawValue.startsWith('{') && rawValue.endsWith('}')) {
        return {
            key,
            type: 'grouped',
            value: rawValue.slice(1, -1).trim(),
            rawValue
        };
    }

    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
        return {
            key,
            type: 'range',
            value: rawValue.slice(1, -1).trim(),
            rawValue
        };
    }

    return {
        key,
        type: 'scalar',
        value: rawValue,
        rawValue
    };
}

function parseVariableRecipe(raw) {
    const parts = splitTopLevel(String(raw || ''));
    const variables = [];

    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) {
            continue;
        }

        const orderMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(\d+)$/);
        if (orderMatch) {
            const order = parseInt(orderMatch[2], 10);
            if (!Number.isInteger(order) || order < 1) {
                return { success: false, error: `Invalid derivative order for "${orderMatch[1]}".` };
            }
            variables.push({ name: orderMatch[1], order });
            continue;
        }

        if (!VALID_VAR_RE.test(trimmed)) {
            return { success: false, error: `Invalid variable name "${trimmed}".` };
        }

        variables.push({ name: trimmed, order: 1 });
    }

    if (variables.length === 0) {
        return { success: false, error: 'Expected at least one variable.' };
    }

    return { success: true, variables };
}

function parseAssignmentList(raw) {
    const assignments = [];
    const parts = splitTopLevel(String(raw || ''));

    for (const part of parts) {
        const token = parseOptionToken(part);
        if (!token || token.type === 'range') {
            return { success: false, error: `Invalid assignment "${part}". Use name:expression.` };
        }
        if (!VALID_VAR_RE.test(token.key)) {
            return { success: false, error: `Invalid assignment target "${token.key}".` };
        }
        assignments.push({ name: token.key, exprSource: token.value });
    }

    return { success: true, assignments };
}

function parseRangeOptionText(text) {
    const option = parseOptionToken(text);
    if (!option || option.type !== 'range' || !VALID_VAR_RE.test(option.key)) {
        return null;
    }

    const parts = splitTopLevel(option.value);
    if (parts.length !== 2) {
        return { success: false, error: `Range "${text}" must contain exactly two bounds.` };
    }

    return {
        success: true,
        range: {
            name: option.key,
            lowerSource: parts[0].trim(),
            upperSource: parts[1].trim()
        }
    };
}

function parseTupleSource(source) {
    const text = String(source || '').trim();
    if (!text) {
        return [];
    }

    let inner = text;
    if (
        (text.startsWith('(') && text.endsWith(')')) ||
        (text.startsWith('[') && text.endsWith(']')) ||
        (text.startsWith('{') && text.endsWith('}'))
    ) {
        inner = text.slice(1, -1).trim();
    }

    return splitTopLevel(inner);
}

function inferDefaultVariable(exprSource, extractVars, actionLabel, excludeVars = []) {
    const excludeSet = new Set(excludeVars);
    const exprVars = unique(extractVars(exprSource)).filter(v => !excludeSet.has(v));

    if (exprVars.length === 0) {
        return { success: true, variable: 'x' };
    }
    if (exprVars.length === 1) {
        return { success: true, variable: exprVars[0] };
    }
    if (exprVars.includes('x')) {
        return { success: true, variable: 'x' };
    }

    return {
        success: false,
        error: `Could not infer a single variable for ${actionLabel}. Found multiple variables (${exprVars.join(', ')}).`
    };
}

function orderedUniqueVariableNames(recipe) {
    return unique((recipe || []).map((entry) => entry.name));
}

function orderPreferredVariables(variableNames = []) {
    return unique(variableNames).sort((a, b) => {
        const aIndex = VECTOR_VAR_PREFERENCES.indexOf(a);
        const bIndex = VECTOR_VAR_PREFERENCES.indexOf(b);
        const aRank = aIndex === -1 ? VECTOR_VAR_PREFERENCES.length : aIndex;
        const bRank = bIndex === -1 ? VECTOR_VAR_PREFERENCES.length : bIndex;

        if (aRank !== bRank) {
            return aRank - bRank;
        }

        return a.localeCompare(b);
    });
}

function flattenDerivativeRecipe(recipe) {
    const sequence = [];
    for (const entry of recipe || []) {
        const order = Number(entry.order) || 1;
        for (let index = 0; index < order; index++) {
            sequence.push(entry.name);
        }
    }
    return sequence;
}

function isBareVariableDescriptor(descriptor) {
    return descriptor && descriptor.kind === 'string' && VALID_VAR_RE.test(String(descriptor.source || '').trim());
}

function isOptionDescriptor(descriptor) {
    return descriptor && descriptor.kind === 'string' && Boolean(parseOptionToken(descriptor.source));
}

function normalizeExpressionSource(descriptor, label) {
    if (!descriptor) {
        return { success: false, error: `${label} requires an expression.` };
    }
    const exprSource = String(descriptor.source || '').trim();
    if (!exprSource) {
        return { success: false, error: `${label} requires a non-empty expression.` };
    }
    return { success: true, exprSource };
}

function buildVectorHelperLegacyError(functionName) {
    return {
        success: false,
        error: `${functionName} no longer accepts positional coordinate arguments. Omit them and let the helper infer variables, or use vars:{...}.`
    };
}

function inferScalarVectorVariables(exprSource, extractVars) {
    const inferred = orderPreferredVariables(extractVars(exprSource));
    return inferred.length > 0 ? inferred : ['x'];
}

function inferFieldVectorVariables(exprSource, dimension, functionName, extractVars) {
    const components = parseTupleSource(exprSource);
    const inferred = orderPreferredVariables(
        components.flatMap((component) => extractVars(component))
    );

    if (inferred.length === dimension) {
        return { success: true, variables: inferred, components };
    }

    if (inferred.length > dimension) {
        return {
            success: true,
            variables: inferred.slice(0, dimension),
            components
        };
    }

    if (inferred.length === 0) {
        return {
            success: true,
            variables: ['x', 'y', 'z'].slice(0, dimension),
            components
        };
    }

    if (inferred.every((name) => COORDINATE_NAMES.has(name))) {
        const filled = [...inferred];
        for (const defaultName of ['x', 'y', 'z']) {
            if (filled.length === dimension) {
                break;
            }
            if (!filled.includes(defaultName)) {
                filled.push(defaultName);
            }
        }
        return { success: true, variables: filled, components };
    }

    return {
        success: false,
        error: `Could not infer ${dimension} coordinate variables for ${functionName}. Use vars:{...} to specify them explicitly.`
    };
}

function parseVectorHelperCall(functionName, descriptors, extractVars) {
    const exprResult = normalizeExpressionSource(descriptors[0], functionName);
    if (!exprResult.success) {
        return exprResult;
    }

    const exprSource = exprResult.exprSource;
    const rest = descriptors.slice(1);
    let variableRecipe = null;

    for (const descriptor of rest) {
        if (descriptor.kind !== 'string') {
            return buildVectorHelperLegacyError(functionName);
        }

        const raw = String(descriptor.source || '').trim();
        if (!raw) {
            continue;
        }

        const option = parseOptionToken(raw);
        if (!option) {
            if (VALID_VAR_RE.test(raw)) {
                return buildVectorHelperLegacyError(functionName);
            }
            return { success: false, error: `Unsupported ${functionName} helper argument "${raw}".` };
        }

        if (option.key !== 'vars') {
            return { success: false, error: `Unsupported ${functionName} helper option "${option.key}".` };
        }

        const parsedRecipe = parseVariableRecipe(option.value);
        if (!parsedRecipe.success) {
            return parsedRecipe;
        }

        if (parsedRecipe.variables.some((entry) => entry.order !== 1)) {
            return {
                success: false,
                error: `${functionName} vars do not support derivative-style order markers.`
            };
        }

        const rawNames = parsedRecipe.variables.map((entry) => entry.name);
        if (new Set(rawNames).size !== rawNames.length) {
            return {
                success: false,
                error: `${functionName} coordinate variables must be unique.`
            };
        }

        variableRecipe = parsedRecipe.variables;
    }

    if (VECTOR_FIELD_INLINE_HELPERS.has(functionName)) {
        const components = parseTupleSource(exprSource);
        const dimension = components.length;
        if (dimension < 2 || dimension > 3) {
            return {
                success: false,
                error: `${functionName} only supports 2D or 3D vector fields.`
            };
        }

        let varNames;
        if (variableRecipe) {
            varNames = parsedRecipeNames(variableRecipe);
        } else {
            const inferred = inferFieldVectorVariables(exprSource, dimension, functionName, extractVars);
            if (!inferred.success) {
                return inferred;
            }
            varNames = inferred.variables;
        }

        if (varNames.length !== dimension) {
            return {
                success: false,
                error: `${functionName} expects ${dimension} coordinate variable${dimension === 1 ? '' : 's'} for this vector field.`
            };
        }

        return {
            success: true,
            functionName,
            exprSource,
            varNames,
            dimension,
            components
        };
    }

    const varNames = variableRecipe
        ? parsedRecipeNames(variableRecipe)
        : inferScalarVectorVariables(exprSource, extractVars);

    if (varNames.length < 1 || varNames.length > 3) {
        return {
            success: false,
            error: `${functionName} only supports 1 to 3 coordinate variables.`
        };
    }

    return {
        success: true,
        functionName,
        exprSource,
        varNames,
        dimension: varNames.length
    };
}

function parsedRecipeNames(recipe) {
    return (recipe || []).map((entry) => entry.name);
}

function parseDerivativeCall(descriptors, extractVars) {
    const exprResult = normalizeExpressionSource(descriptors[0], 'deriv');
    if (!exprResult.success) {
        return exprResult;
    }

    const exprSource = exprResult.exprSource;
    const rest = descriptors.slice(1);
    const hasOptionLikeArgs = rest.some(isOptionDescriptor);

    let recipe = null;
    let dep = null;
    let atAssignments = [];
    let positionalEvalSources = [];
    let usesPositionalSyntax = false;

    if (
        rest.length > 0 &&
        isBareVariableDescriptor(rest[0]) &&
        !hasOptionLikeArgs
    ) {
        recipe = [{ name: rest[0].source.trim(), order: 1 }];
        positionalEvalSources = rest.slice(1).map((descriptor) => descriptor.source);
        usesPositionalSyntax = true;
    } else {
        for (const descriptor of rest) {
            if (descriptor.kind !== 'string') {
                positionalEvalSources.push(descriptor.source);
                continue;
            }

            const bare = String(descriptor.source || '').trim();
            const option = parseOptionToken(bare);
            if (!option) {
                if (!recipe && VALID_VAR_RE.test(bare)) {
                    recipe = [{ name: bare, order: 1 }];
                    continue;
                }
                positionalEvalSources.push(descriptor.source);
                continue;
            }

            if (option.key === 'vars') {
                const parsedRecipe = parseVariableRecipe(option.value);
                if (!parsedRecipe.success) {
                    return parsedRecipe;
                }
                recipe = parsedRecipe.variables;
                continue;
            }

            if (option.key === 'dep') {
                const depParts = splitTopLevel(option.value, ',');
                const depVars = [];
                for (const part of depParts) {
                    const name = part.trim();
                    if (!name) continue;
                    if (!VALID_VAR_RE.test(name)) {
                        return { success: false, error: `Invalid dependent variable name "${name}" in dep option.` };
                    }
                    depVars.push(name);
                }
                dep = depVars;
                continue;
            }

            if (option.key === 'at') {
                const parsedAssignments = parseAssignmentList(option.value);
                if (!parsedAssignments.success) {
                    return parsedAssignments;
                }
                atAssignments = parsedAssignments.assignments;
                continue;
            }

            return { success: false, error: `Unsupported deriv helper option "${option.key}".` };
        }
    }

    if (!recipe) {
        const inferred = inferDefaultVariable(exprSource, extractVars, 'inline differentiation', dep || []);
        if (!inferred.success) {
            return inferred;
        }
        recipe = [{ name: inferred.variable, order: 1 }];
    }

    const uniqueVariables = orderedUniqueVariableNames(recipe);
    if (positionalEvalSources.length > 0 && positionalEvalSources.length !== uniqueVariables.length) {
        return {
            success: false,
            error: `deriv positional evaluation arguments must match the number of unique variables (${uniqueVariables.length}).`
        };
    }

    return {
        success: true,
        exprSource,
        recipe,
        sequence: flattenDerivativeRecipe(recipe),
        uniqueVariables,
        atAssignments,
        positionalEvalSources,
        usesPositionalSyntax,
        dep
    };
}

function parseIntegralCall(descriptors, extractVars) {
    const exprResult = normalizeExpressionSource(descriptors[0], 'integ');
    if (!exprResult.success) {
        return exprResult;
    }

    const exprSource = exprResult.exprSource;
    const rest = descriptors.slice(1);
    const hasOptionLikeArgs = rest.some(isOptionDescriptor);

    let kind = null;
    let paramSource = null;
    let ranges = [];
    let variableRecipe = null;
    let usesPositionalSyntax = false;

    if (rest.length > 0 && isBareVariableDescriptor(rest[0]) && !hasOptionLikeArgs) {
        const varName = rest[0].source.trim();
        if (rest.length === 1) {
            variableRecipe = [{ name: varName, order: 1 }];
            usesPositionalSyntax = true;
        } else {
            return {
                success: false,
                error: 'Definite integ syntax no longer accepts positional bounds. Use integ[expr, x:[lower, upper]] or integ("expr", "x:[lower, upper]").'
            };
        }
    } else {
        for (const descriptor of rest) {
            if (descriptor.kind !== 'string') {
                return { success: false, error: 'integ helper options must be written as strings.' };
            }

            const bare = String(descriptor.source || '').trim();
            const rangeResult = parseRangeOptionText(bare);
            if (rangeResult) {
                if (!rangeResult.success) {
                    return rangeResult;
                }
                ranges.push(rangeResult.range);
                continue;
            }

            const option = parseOptionToken(bare);
            if (!option) {
                if (!variableRecipe && VALID_VAR_RE.test(bare)) {
                    variableRecipe = [{ name: bare, order: 1 }];
                    continue;
                }
                return { success: false, error: `Unsupported integ helper argument "${bare}".` };
            }

            if (option.key === 'kind') {
                kind = option.value.toLowerCase();
                continue;
            }

            if (option.key === 'param') {
                paramSource = option.value;
                continue;
            }

            if (option.key === 'vars') {
                const parsedRecipe = parseVariableRecipe(option.value);
                if (!parsedRecipe.success) {
                    return parsedRecipe;
                }
                if (parsedRecipe.variables.some((entry) => entry.order !== 1)) {
                    return {
                        success: false,
                        error: 'integ vars do not support derivative-style order markers.'
                    };
                }
                variableRecipe = parsedRecipe.variables;
                continue;
            }

            return { success: false, error: `Unsupported integ helper option "${option.key}".` };
        }
    }

    if (kind && !['line', 'surface', 'volume'].includes(kind)) {
        return { success: false, error: `Unsupported integral kind "${kind}".` };
    }

    if (!kind && ranges.length === 0 && !variableRecipe) {
        const inferred = inferDefaultVariable(exprSource, extractVars, 'inline integration');
        if (!inferred.success) {
            return inferred;
        }
        variableRecipe = [{ name: inferred.variable, order: 1 }];
    }

    let mode = 'standard';
    let antiderivativeRanges = [];
    if (!kind && ranges.length === 0) {
        antiderivativeRanges = (variableRecipe || []).map((entry) => ({
            name: entry.name,
            lowerSource: '0',
            upperSource: entry.name,
            isAntiderivative: true
        }));
    } else if (kind === 'line') {
        mode = 'line';
    } else if (kind === 'surface') {
        mode = 'surface';
    } else if (kind === 'volume') {
        mode = 'volume';
    }

    return {
        success: true,
        exprSource,
        kind,
        mode,
        paramSource,
        ranges,
        variableRecipe,
        antiderivativeRanges,
        usesPositionalSyntax
    };
}

function inferParameterNames(paramSource, expectedCount, rangeNames, extractVars, preferences) {
    const explicitRangeNames = unique(rangeNames).slice(0, expectedCount);
    if (explicitRangeNames.length === expectedCount) {
        return explicitRangeNames;
    }

    const tupleParts = parseTupleSource(paramSource);
    const candidateNames = unique(
        tupleParts.flatMap((part) => extractVars(part))
            .filter((name) => !COORDINATE_NAMES.has(name))
    );

    const preferredNames = [];
    for (const preference of preferences) {
        if (candidateNames.includes(preference) && !preferredNames.includes(preference)) {
            preferredNames.push(preference);
        }
    }

    const ordered = unique([...explicitRangeNames, ...preferredNames, ...candidateNames]);
    return ordered.slice(0, expectedCount);
}

function extractDerivativeDependencies(config, extractVars) {
    const deps = new Set(extractVars(config.exprSource));

    for (const assignment of config.atAssignments || []) {
        for (const name of extractVars(assignment.exprSource)) {
            deps.add(name);
        }
    }

    for (const source of config.positionalEvalSources || []) {
        for (const name of extractVars(source)) {
            deps.add(name);
        }
    }

    return Array.from(deps);
}

function extractStandardIntegralDependencies(config, extractVars) {
    const deps = new Set();

    const integratedVars = new Set([
        ...(config.ranges || []).map((range) => range.name),
        ...(config.antiderivativeRanges || []).map((range) => range.name)
    ]);

    for (const name of extractVars(config.exprSource)) {
        if (!integratedVars.has(name)) {
            deps.add(name);
        }
    }

    for (const range of config.ranges || []) {
        for (const name of extractVars(range.lowerSource)) {
            if (!integratedVars.has(name)) {
                deps.add(name);
            }
        }
        for (const name of extractVars(range.upperSource)) {
            if (!integratedVars.has(name)) {
                deps.add(name);
            }
        }
    }

    for (const range of config.antiderivativeRanges || []) {
        deps.add(range.name);
    }

    return Array.from(deps);
}

function extractLineOrSurfaceDependencies(config, extractVars, expectedParams, preferences) {
    const deps = new Set();
    const paramNames = inferParameterNames(
        config.paramSource,
        expectedParams,
        (config.ranges || []).map((range) => range.name),
        extractVars,
        preferences
    );
    const paramSet = new Set(paramNames);

    for (const name of extractVars(config.exprSource)) {
        if (!COORDINATE_NAMES.has(name) && !paramSet.has(name)) {
            deps.add(name);
        }
    }

    for (const component of parseTupleSource(config.paramSource)) {
        for (const name of extractVars(component)) {
            if (!paramSet.has(name)) {
                deps.add(name);
            }
        }
    }

    for (const range of config.ranges || []) {
        for (const name of extractVars(range.lowerSource)) {
            if (!paramSet.has(name)) {
                deps.add(name);
            }
        }
        for (const name of extractVars(range.upperSource)) {
            if (!paramSet.has(name)) {
                deps.add(name);
            }
        }
    }

    return Array.from(deps);
}

function extractVolumeDependencies(config, extractVars) {
    const integratedVars = new Set((config.ranges || []).map((range) => range.name));
    const deps = new Set();

    for (const name of extractVars(config.exprSource)) {
        if (!integratedVars.has(name)) {
            deps.add(name);
        }
    }

    for (const range of config.ranges || []) {
        for (const name of extractVars(range.lowerSource)) {
            if (!integratedVars.has(name)) {
                deps.add(name);
            }
        }
        for (const name of extractVars(range.upperSource)) {
            if (!integratedVars.has(name)) {
                deps.add(name);
            }
        }
    }

    return Array.from(deps);
}

function extractVectorHelperDependencies(config, extractVars) {
    if (VECTOR_FIELD_INLINE_HELPERS.has(config.functionName)) {
        const deps = new Set();
        for (const component of config.components || []) {
            for (const name of extractVars(component)) {
                deps.add(name);
            }
        }
        return Array.from(deps);
    }

    return Array.from(new Set(extractVars(config.exprSource)));
}

function extractInlineDependencies(functionName, descriptors, extractVars) {
    if (functionName === 'deriv') {
        const parsed = parseDerivativeCall(descriptors, extractVars);
        if (!parsed.success) {
            return [];
        }
        return extractDerivativeDependencies(parsed, extractVars);
    }

    if (functionName === 'integ') {
        const parsed = parseIntegralCall(descriptors, extractVars);
        if (!parsed.success) {
            return [];
        }

        if (parsed.mode === 'line') {
            return extractLineOrSurfaceDependencies(parsed, extractVars, 1, LINE_PARAM_PREFERENCES);
        }
        if (parsed.mode === 'surface') {
            return extractLineOrSurfaceDependencies(parsed, extractVars, 2, SURFACE_PARAM_PREFERENCES);
        }
        if (parsed.mode === 'volume') {
            return extractVolumeDependencies(parsed, extractVars);
        }
        return extractStandardIntegralDependencies(parsed, extractVars);
    }

    if (VECTOR_INLINE_HELPERS.has(functionName)) {
        const parsed = parseVectorHelperCall(functionName, descriptors, extractVars);
        if (!parsed.success) {
            return [];
        }
        return extractVectorHelperDependencies(parsed, extractVars);
    }

    return [];
}

module.exports = {
    COORDINATE_NAMES,
    LINE_PARAM_PREFERENCES,
    SURFACE_PARAM_PREFERENCES,
    VALID_VAR_RE,
    VECTOR_INLINE_HELPERS,
    extractInlineDependencies,
    findTopLevelColon,
    flattenDerivativeRecipe,
    inferDefaultVariable,
    inferParameterNames,
    orderedUniqueVariableNames,
    parseAssignmentList,
    parseDerivativeCall,
    parseIntegralCall,
    parseOptionToken,
    parseVectorHelperCall,
    parseRangeOptionText,
    parseTupleSource,
    parseVariableRecipe,
    unique
};
