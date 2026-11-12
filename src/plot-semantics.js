const math = require('./math');
const { splitTopLevel, isReservedMathSymbol } = require('./utils');
const { extractInlineDependencies, VECTOR_INLINE_HELPERS } = require('./inline-calculus');


function unique(items) {
    const seen = new Set();
    const out = [];
    for (const item of items || []) {
        const key = String(item || '').trim();
        if (!key || seen.has(key)) {
            continue;
        }
        seen.add(key);
        out.push(key);
    }
    return out;
}

function normalizeVariables(variables) {
    if (!Array.isArray(variables)) {
        return [];
    }
    return unique(
        variables.map((entry) => {
            if (!entry) return '';
            if (typeof entry === 'string') return entry;
            return entry.name || '';
        })
    );
}

function parseVectorTuple(expr, expectedDimension = null) {
    const trimmed = String(expr || '').trim();
    if (!trimmed) {
        return null;
    }

    const hasParens = trimmed.startsWith('(') && trimmed.endsWith(')');
    const hasBrackets = trimmed.startsWith('[') && trimmed.endsWith(']');
    if (!hasParens && !hasBrackets) {
        return null;
    }

    const components = splitTopLevel(trimmed.slice(1, -1))
        .map((component) => component.trim())
        .filter(Boolean);

    if (expectedDimension !== null && components.length !== expectedDimension) {
        return null;
    }

    return components;
}

function findTopLevelOperatorIndex(text, operator = '=') {
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let inQuotes = false;
    let quoteChar = null;

    for (let index = 0; index < text.length; index++) {
        const char = text[index];

        if (inQuotes) {
            if (char === '\\' && index + 1 < text.length) {
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

        if (
            char === operator &&
            parenDepth === 0 &&
            bracketDepth === 0 &&
            braceDepth === 0
        ) {
            return index;
        }
    }

    return -1;
}

function splitTopLevelEquation(expr) {
    const text = String(expr || '').trim();
    const eqIndex = findTopLevelOperatorIndex(text, '=');
    if (eqIndex === -1) {
        return null;
    }

    return {
        lhs: text.slice(0, eqIndex).trim(),
        rhs: text.slice(eqIndex + 1).trim()
    };
}

function parseNamedVectorField(expr, expectedDimension = null) {
    const equation = splitTopLevelEquation(expr);
    if (!equation) {
        return null;
    }

    const lhsMatch = equation.lhs.match(/^([A-Za-z][A-Za-z0-9_]*)\(\s*(.+)\s*\)$/);
    if (!lhsMatch) {
        return null;
    }

    const vars = splitTopLevel(lhsMatch[2])
        .map((part) => part.trim())
        .filter((part) => /^[A-Za-z][A-Za-z0-9_]*$/.test(part));

    const components = parseVectorTuple(equation.rhs, expectedDimension);
    if (!components) {
        return null;
    }

    if (expectedDimension !== null && vars.length !== expectedDimension) {
        return null;
    }

    return {
        name: lhsMatch[1],
        vars: unique(vars),
        components
    };
}

function extractExpressionVariables(expr) {
    const vars = new Set();

    function collectPlainVariables(source) {
        try {
            return extractExpressionVariables(source);
        } catch (_) {
            return [];
        }
    }

    function buildInlineArgDescriptors(args = []) {
        return args.map((arg) => ({
            kind: (arg && typeof arg.value === 'string') ? 'string' : 'expr',
            source: String((arg && typeof arg.value === 'string') ? arg.value : arg.toString())
        }));
    }

    function traverse(node, parent) {
        if (!node) return;

        if (node.isFunctionNode && node.fn && node.fn.isSymbolNode) {
            const helperName = node.fn.name;
            if (helperName === 'deriv' || helperName === 'integ' || VECTOR_INLINE_HELPERS.has(helperName)) {
                const helperDeps = extractInlineDependencies(
                    helperName,
                    buildInlineArgDescriptors(node.args),
                    collectPlainVariables
                );
                helperDeps.forEach((name) => {
                    if (!isReservedMathSymbol(math, name)) {
                        vars.add(name);
                    }
                });
                return;
            }
        }

        if (node.isSymbolNode) {
            if (parent && parent.isFunctionNode && parent.fn === node) {
                return;
            }
            const name = node.name;
            if (!name || isReservedMathSymbol(math, name)) {
                return;
            }
            vars.add(name);
        }

        node.forEach((child) => traverse(child, node));
    }

    try {
        const parsed = math.parse(String(expr || ''));
        traverse(parsed, null);
        return Array.from(vars);
    } catch (_) {
        return [];
    }
}

function expressionUsesAnySymbol(expr, symbolNames) {
    if (!Array.isArray(symbolNames) || symbolNames.length === 0) {
        return false;
    }

    const names = new Set(symbolNames.map((name) => String(name).trim()).filter(Boolean));
    if (names.size === 0) {
        return false;
    }

    const vars = extractExpressionVariables(expr);
    return vars.some((v) => names.has(v));
}

function inferSingleVariable({ explicitVars = [], rangeNames = [], exprVars = [], preferred = [], fallback = 'x' }) {
    if (explicitVars.length) return explicitVars[0];
    const used = new Set(exprVars);
    const preferredInExpression = preferred.find((name) => used.has(name));
    if (preferredInExpression) return preferredInExpression;
    const rangedInExpression = rangeNames.find((name) => used.has(name));
    if (rangedInExpression) return rangedInExpression;
    if (exprVars.length) return exprVars[0];
    const preferredRange = preferred.find((name) => rangeNames.includes(name));
    return preferredRange || rangeNames[0] || preferred[0] || fallback;
}

function inferCoordinateVariables({ explicitVars = [], rangeNames = [], exprVars = [], defaults = ['x', 'y'] }) {
    const coords = unique(explicitVars).slice(0, defaults.length);
    if (coords.length === defaults.length) {
        return coords;
    }

    // A range should not invent an unrelated coordinate. Prefer conventional
    // axes that actually occur, then named expression variables, then defaults.
    const named = new Set([...rangeNames, ...exprVars]);
    const pool = unique([
        ...defaults.filter((name) => named.has(name)),
        ...rangeNames.filter((name) => exprVars.includes(name)),
        ...exprVars,
        ...defaults
    ]);
    for (const candidate of pool) {
        if (coords.length === defaults.length) {
            break;
        }
        if (!coords.includes(candidate)) {
            coords.push(candidate);
        }
    }

    const result = coords.slice(0, defaults.length);
    if (!explicitVars.length && result.every((name) => defaults.includes(name))) {
        return defaults.filter((name) => result.includes(name));
    }
    return result;
}

function inferCoordinateSystem(varNames = [], expr = '', components = []) {
    const names = new Set((varNames || []).map((name) => String(name).trim()).filter(Boolean));
    const searchText = [expr, ...(components || [])].join(' ');

    if (names.has('phi') || (names.has('theta') && names.has('phi')) || /\bphi\b/.test(searchText)) {
        return 'spherical';
    }

    if ((names.has('r') && names.has('theta') && names.has('z')) || /\br\b/.test(searchText) || /\btheta\b/.test(searchText)) {
        if (!/\bz\b/.test(searchText) && !names.has('z') && /\btheta\b/.test(searchText)) {
            return 'spherical';
        }
        return 'cylindrical';
    }

    return 'cartesian';
}

function shouldTreatBareTupleAsVector(components, domainsCount) {
    const hasUV = components.some((component) => expressionUsesAnySymbol(component, ['u', 'v']));
    if (hasUV) return false;
    const hasT = components.some((component) => expressionUsesAnySymbol(component, ['t']));
    const hasXYZ = components.some((component) => expressionUsesAnySymbol(component, ['x', 'y', 'z', 'r', 'theta', 'phi']));
    if (hasT && !hasXYZ) {
        return false;
    }
    if (domainsCount >= 2) {
        return true;
    }
    return hasXYZ;
}

function detectTupleParameterVariable(expr, components = []) {
    const searchSpace = Array.isArray(components) && components.length > 0 ? components : [expr];

    if (searchSpace.some((component) => expressionUsesAnySymbol(component, ['t']))) {
        return 't';
    }

    if (searchSpace.some((component) => expressionUsesAnySymbol(component, ['theta']))) {
        return 'theta';
    }

    return null;
}

function analyze2dPlot(expr, options = {}) {
    const text = String(expr || '').trim();
    const kind = options.kind ? String(options.kind).trim().toLowerCase() : null;
    const explicitVars = normalizeVariables(options.variables);
    const rangeNames = Object.keys(options.labeledDomains || {});
    const equation = splitTopLevelEquation(text);
    const namedVectorField = parseNamedVectorField(text, 2);
    const tuple = namedVectorField ? null : parseVectorTuple(text, 2);
    const tupleVars = unique((tuple || []).flatMap((component) => extractExpressionVariables(component)));
    const exprVars = extractExpressionVariables(text);
    const tupleParameterVar = tuple && !kind && !namedVectorField
        ? detectTupleParameterVariable(text, tuple)
        : null;

    if (tuple && !kind && !namedVectorField && !tupleParameterVar) {
        throw new Error(
            'Ambiguous plot: Please specify kind:vector to plot a vector field, or kind:parametric to plot a parametric curve.'
        );
    }

    if (kind === 'vector' || namedVectorField) {
        const coordVars = inferCoordinateVariables({
            explicitVars: explicitVars.length >= 2 ? explicitVars : (namedVectorField ? namedVectorField.vars : []),
            rangeNames,
            exprVars: namedVectorField ? namedVectorField.vars : tupleVars,
            defaults: ['x', 'y']
        });

        return {
            family: 'vector',
            components: namedVectorField ? namedVectorField.components : tuple,
            coordVars,
            funcName: namedVectorField ? namedVectorField.name : 'F'
        };
    }

    if (kind === 'parametric' || (tuple && tupleParameterVar)) {
        return {
            family: 'parametric',
            components: tuple,
            parameterVar: inferSingleVariable({
                explicitVars,
                rangeNames,
                exprVars: tupleVars,
                preferred: tupleParameterVar === 'theta' ? ['theta', 't'] : ['t', 'theta'],
                fallback: tupleParameterVar || 't'
            })
        };
    }

    if (kind === 'polar' || (equation && equation.lhs === 'r') || (!equation && expressionUsesAnySymbol(text, ['theta']))) {
        const angleVar = inferSingleVariable({
            explicitVars,
            rangeNames,
            exprVars,
            preferred: ['theta'],
            fallback: 'theta'
        });

        if (!equation) {
            return {
                family: 'polar',
                rhs: text,
                angleVar
            };
        }

        if (equation.lhs === 'r') {
            return {
                family: 'polar',
                lhs: equation.lhs,
                rhs: equation.rhs,
                angleVar
            };
        }

        return {
            family: 'implicit-polar',
            lhs: equation.lhs,
            rhs: equation.rhs,
            angleVar
        };
    }

    if (equation) {
        const coordVars = inferCoordinateVariables({
            explicitVars,
            rangeNames,
            exprVars,
            defaults: ['x', 'y']
        });
        const dependentVar = explicitVars[1] || 'y';
        const explicitMatch = equation.lhs === dependentVar || /^(y|f\(x\))$/.test(equation.lhs);

        if (explicitMatch) {
            return {
                family: 'explicit',
                lhs: equation.lhs,
                rhs: equation.rhs,
                independentVar: inferSingleVariable({
                    explicitVars,
                    rangeNames: rangeNames.filter((name) => name !== dependentVar),
                    exprVars: extractExpressionVariables(equation.rhs),
                    preferred: ['x'],
                    fallback: 'x'
                }),
                dependentVar
            };
        }

        return {
            family: 'implicit',
            lhs: equation.lhs,
            rhs: equation.rhs,
            coordVars
        };
    }

    return {
        family: 'explicit',
        lhs: explicitVars[1] || 'y',
        rhs: text,
        independentVar: inferSingleVariable({
            explicitVars,
            rangeNames,
            exprVars,
            preferred: ['x'],
            fallback: 'x'
        }),
        dependentVar: explicitVars[1] || 'y'
    };
}

function analyze3dPlot(expr, options = {}) {
    const text = String(expr || '').trim();
    const kind = options.kind ? String(options.kind).trim().toLowerCase() : null;
    const explicitVars = normalizeVariables(options.variables);
    const rangeNames = Object.keys(options.labeledDomains || {});
    const equation = splitTopLevelEquation(text);
    const namedVectorField = parseNamedVectorField(text, 3);
    const tuple3 = namedVectorField ? null : parseVectorTuple(text, 3);
    const tuple2 = (!tuple3 && !namedVectorField) ? parseVectorTuple(text, 2) : null;
    const tupleVars3 = unique((tuple3 || []).flatMap((component) => extractExpressionVariables(component)));
    const tupleVars2 = unique((tuple2 || []).flatMap((component) => extractExpressionVariables(component)));
    const exprVars = extractExpressionVariables(text);

    if (kind === 'vector' || namedVectorField || (tuple3 && explicitVars.length === 3)) {
        const coordVars = inferCoordinateVariables({
            explicitVars: explicitVars.length >= 3 ? explicitVars : (namedVectorField ? namedVectorField.vars : []),
            rangeNames,
            exprVars: namedVectorField ? namedVectorField.vars : tupleVars3,
            defaults: ['x', 'y', 'z']
        });

        return {
            family: 'vector',
            components: namedVectorField ? namedVectorField.components : tuple3,
            coordVars,
            coordSystem: inferCoordinateSystem(coordVars, text, namedVectorField ? namedVectorField.components : tuple3),
            funcName: namedVectorField ? namedVectorField.name : 'F'
        };
    }

    if (kind === 'surface') {
        if (tuple3) {
            const paramVars = inferCoordinateVariables({
                explicitVars,
                rangeNames,
                exprVars: tupleVars3,
                defaults: ['u', 'v']
            }).slice(0, 2);

            return {
                family: 'surface-parametric',
                components: tuple3,
                paramVars,
                coordSystem: inferCoordinateSystem(paramVars, text, tuple3)
            };
        }

        if (equation && equation.lhs === 'r') {
            const coordSystem = inferCoordinateSystem(explicitVars, text);
            const defaults = coordSystem === 'spherical' ? ['theta', 'phi'] : ['theta', 'z'];
            const paramVars = inferCoordinateVariables({
                explicitVars,
                rangeNames,
                exprVars,
                defaults
            }).slice(0, 2);

            return {
                family: 'surface-polar',
                lhs: equation.lhs,
                rhs: equation.rhs,
                paramVars,
                coordSystem
            };
        }

        if (equation && equation.lhs !== 'z') {
            return {
                family: 'surface-implicit',
                lhs: equation.lhs,
                rhs: equation.rhs,
                coordVars: inferCoordinateVariables({
                    explicitVars,
                    rangeNames,
                    exprVars,
                    defaults: ['x', 'y', 'z']
                }),
                coordSystem: inferCoordinateSystem(explicitVars, text)
            };
        }

        return {
            family: 'surface-explicit',
            lhs: equation ? equation.lhs : 'z',
            rhs: equation ? equation.rhs : text,
            surfaceVars: inferCoordinateVariables({
                explicitVars,
                rangeNames: rangeNames.filter((name) => name !== 'z'),
                exprVars: equation ? extractExpressionVariables(equation.rhs) : exprVars,
                defaults: ['x', 'y']
            }).slice(0, 2),
            coordSystem: inferCoordinateSystem(explicitVars, text)
        };
    }

    if (kind === 'curve') {
        if (tuple3 || tuple2) {
            const components = tuple3 || [...tuple2, '0'];
            return {
                family: 'curve-parametric',
                components,
                paramVar: inferSingleVariable({
                    explicitVars,
                    rangeNames,
                    exprVars: tuple3 ? tupleVars3 : tupleVars2,
                    preferred: ['t'],
                    fallback: 't'
                })
            };
        }

        if (equation && (equation.lhs === 'r' || expressionUsesAnySymbol(text, ['theta']))) {
            return {
                family: 'curve-polar-2d',
                lhs: equation.lhs,
                rhs: equation.rhs,
                angleVar: inferSingleVariable({
                    explicitVars,
                    rangeNames,
                    exprVars,
                    preferred: ['theta'],
                    fallback: 'theta'
                })
            };
        }

        if (equation) {
            const coordVars = inferCoordinateVariables({
                explicitVars,
                rangeNames,
                exprVars,
                defaults: ['x', 'y']
            }).slice(0, 2);
            const dependentVar = explicitVars[1] || 'y';
            const explicitMatch = equation.lhs === dependentVar || /^(y|f\(x\))$/.test(equation.lhs);
            if (explicitMatch) {
                return {
                    family: 'curve-explicit-2d',
                    lhs: equation.lhs,
                    rhs: equation.rhs,
                    independentVar: inferSingleVariable({
                        explicitVars,
                        rangeNames: rangeNames.filter((name) => name !== dependentVar),
                        exprVars: extractExpressionVariables(equation.rhs),
                        preferred: ['x'],
                        fallback: 'x'
                    }),
                    dependentVar
                };
            }
            return {
                family: 'curve-implicit-2d',
                lhs: equation.lhs,
                rhs: equation.rhs,
                coordVars
            };
        }

        return {
            family: 'curve-explicit-2d',
            lhs: explicitVars[1] || 'y',
            rhs: text,
            independentVar: inferSingleVariable({
                explicitVars,
                rangeNames,
                exprVars,
                preferred: ['x'],
                fallback: 'x'
            }),
            dependentVar: explicitVars[1] || 'y'
        };
    }

    if (tuple3) {
        if (explicitVars.length === 1) {
            return {
                family: 'curve-parametric',
                components: tuple3,
                paramVar: explicitVars[0]
            };
        }

        if (explicitVars.length === 2) {
            return {
                family: 'surface-parametric',
                components: tuple3,
                paramVars: explicitVars.slice(0, 2),
                coordSystem: inferCoordinateSystem(explicitVars, text, tuple3)
            };
        }

        const domainsCount = Object.keys(options.labeledDomains || {}).length;
        if (tupleVars3.some((componentVar) => ['u', 'v'].includes(componentVar))) {
            return {
                family: 'surface-parametric',
                components: tuple3,
                paramVars: inferCoordinateVariables({
                    explicitVars,
                    rangeNames,
                    exprVars: tupleVars3,
                    defaults: ['u', 'v']
                }).slice(0, 2),
                coordSystem: inferCoordinateSystem(explicitVars, text, tuple3)
            };
        }

        if (!shouldTreatBareTupleAsVector(tuple3, domainsCount)) {
            return {
                family: 'curve-parametric',
                components: tuple3,
                paramVar: inferSingleVariable({
                    explicitVars,
                    rangeNames,
                    exprVars: tupleVars3,
                    preferred: ['t'],
                    fallback: 't'
                })
            };
        }

        return {
            family: 'vector',
            components: tuple3,
            coordVars: inferCoordinateVariables({
                explicitVars,
                rangeNames,
                exprVars: tupleVars3,
                defaults: ['x', 'y', 'z']
            }),
            coordSystem: inferCoordinateSystem(explicitVars, text, tuple3),
            funcName: 'F'
        };
    }

    if (tuple2) {
        return {
            family: 'curve-parametric',
            components: [...tuple2, '0'],
            paramVar: inferSingleVariable({
                explicitVars,
                rangeNames,
                exprVars: tupleVars2,
                preferred: ['t'],
                fallback: 't'
            })
        };
    }

    if (equation && (equation.lhs === 'r' || expressionUsesAnySymbol(text, ['theta']))) {
        if (equation.lhs === 'r') {
            return {
                family: 'curve-polar-2d',
                lhs: equation.lhs,
                rhs: equation.rhs,
                angleVar: inferSingleVariable({
                    explicitVars,
                    rangeNames,
                    exprVars,
                    preferred: ['theta'],
                    fallback: 'theta'
                })
            };
        }

        return {
            family: 'curve-implicit-2d',
            lhs: equation.lhs,
            rhs: equation.rhs,
            coordVars: inferCoordinateVariables({
                explicitVars,
                rangeNames,
                exprVars: ['x', 'y'],
                defaults: ['x', 'y']
            }).slice(0, 2),
            polar: true,
            angleVar: inferSingleVariable({
                explicitVars,
                rangeNames,
                exprVars,
                preferred: ['theta'],
                fallback: 'theta'
            })
        };
    }

    if (equation) {
        const coordVars3 = inferCoordinateVariables({
            explicitVars,
            rangeNames,
            exprVars,
            defaults: ['x', 'y', 'z']
        });
        const coordVars2 = coordVars3.slice(0, 2);
        const dependentVar = explicitVars[1] || 'y';
        const explicitCurveMatch = equation.lhs === dependentVar || /^(y|f\(x\))$/.test(equation.lhs);
        const mentionsZ = /\bz\b/.test(text) || coordVars3.includes(equation.lhs);

        if (equation.lhs === 'z') {
            return {
                family: 'surface-explicit',
                lhs: equation.lhs,
                rhs: equation.rhs,
                surfaceVars: inferCoordinateVariables({
                    explicitVars,
                    rangeNames: rangeNames.filter((name) => name !== 'z'),
                    exprVars: extractExpressionVariables(equation.rhs),
                    defaults: ['x', 'y']
                }),
                coordSystem: inferCoordinateSystem(explicitVars, text)
            };
        }

        if (explicitCurveMatch && !mentionsZ) {
            return {
                family: 'curve-explicit-2d',
                lhs: equation.lhs,
                rhs: equation.rhs,
                independentVar: inferSingleVariable({
                    explicitVars,
                    rangeNames: rangeNames.filter((name) => name !== dependentVar),
                    exprVars: extractExpressionVariables(equation.rhs),
                    preferred: ['x'],
                    fallback: 'x'
                }),
                dependentVar
            };
        }

        if (!mentionsZ && coordVars2.every(Boolean)) {
            return {
                family: 'curve-implicit-2d',
                lhs: equation.lhs,
                rhs: equation.rhs,
                coordVars: coordVars2
            };
        }

        return {
            family: 'surface-implicit',
            lhs: equation.lhs,
            rhs: equation.rhs,
            coordVars: coordVars3,
            coordSystem: inferCoordinateSystem(explicitVars, text)
        };
    }

    if (explicitVars.length === 1 || rangeNames.length === 1 || exprVars.length === 1) {
        return {
            family: 'curve-explicit-2d',
            lhs: explicitVars[1] || 'y',
            rhs: text,
            independentVar: inferSingleVariable({
                explicitVars,
                rangeNames,
                exprVars,
                preferred: ['x'],
                fallback: 'x'
            }),
            dependentVar: explicitVars[1] || 'y'
        };
    }

    return {
        family: 'surface-explicit',
        lhs: 'z',
        rhs: text,
        surfaceVars: inferCoordinateVariables({
            explicitVars,
            rangeNames,
            exprVars,
            defaults: ['x', 'y']
        }).slice(0, 2),
        coordSystem: inferCoordinateSystem(explicitVars, text)
    };
}

module.exports = {
    analyze2dPlot,
    analyze3dPlot,
    expressionUsesAnySymbol,
    extractExpressionVariables,
    findTopLevelOperatorIndex,
    inferCoordinateSystem,
    normalizeVariables,
    parseNamedVectorField,
    parseVectorTuple,
    shouldTreatBareTupleAsVector,
    splitTopLevelEquation,
    unique
};
