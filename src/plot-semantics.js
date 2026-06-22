const math = require('./math');
const { splitTopLevel } = require('./utils');

const IGNORED_SYMBOLS = new Set(['pi', 'e', 'i', 'true', 'false', 'NaN', 'null', 'Infinity']);

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
    try {
        const vars = new Set();
        math.parse(String(expr || '')).traverse((node, path, parent) => {
            if (!node || !node.isSymbolNode) {
                return;
            }

            if (parent && parent.isFunctionNode && parent.fn === node) {
                return;
            }

            const name = node.name;
            if (!name || IGNORED_SYMBOLS.has(name) || math[name]) {
                return;
            }

            vars.add(name);
        });
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

    try {
        let found = false;
        math.parse(String(expr || '')).traverse((node, path, parent) => {
            if (found || !node || !node.isSymbolNode) {
                return;
            }

            if (parent && parent.isFunctionNode && parent.fn === node) {
                return;
            }

            if (names.has(node.name)) {
                found = true;
            }
        });
        return found;
    } catch (_) {
        return false;
    }
}

function inferSingleVariable({ explicitVars = [], rangeNames = [], exprVars = [], preferred = [], fallback = 'x' }) {
    const pool = unique([
        ...explicitVars,
        ...preferred,
        ...rangeNames,
        ...exprVars
    ]);

    for (const candidate of pool) {
        if (candidate) {
            return candidate;
        }
    }

    return fallback;
}

function inferCoordinateVariables({ explicitVars = [], rangeNames = [], exprVars = [], defaults = ['x', 'y'] }) {
    const coords = unique(explicitVars).slice(0, defaults.length);
    if (coords.length === defaults.length) {
        return coords;
    }

    const pool = unique([...rangeNames, ...exprVars, ...defaults]);
    for (const candidate of pool) {
        if (coords.length === defaults.length) {
            break;
        }
        if (!coords.includes(candidate)) {
            coords.push(candidate);
        }
    }

    return coords.slice(0, defaults.length);
}

function inferCoordinateSystem(varNames = [], expr = '', components = []) {
    const names = new Set((varNames || []).map((name) => String(name).trim().toLowerCase()).filter(Boolean));
    const searchText = [expr, ...(components || [])].join(' ').toLowerCase();

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

    if (kind === 'vector' || namedVectorField || (tuple && explicitVars.length === 2)) {
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

    if (kind === 'parametric' || (tuple && (explicitVars.length === 1 || tupleVars.length === 1 || expressionUsesAnySymbol(text, ['t'])))) {
        return {
            family: 'parametric',
            components: tuple,
            parameterVar: inferSingleVariable({
                explicitVars,
                rangeNames,
                exprVars: tupleVars,
                preferred: ['t'],
                fallback: 't'
            })
        };
    }

    if (kind === 'polar' || (equation && equation.lhs.toLowerCase() === 'r') || (!equation && expressionUsesAnySymbol(text, ['theta']))) {
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

        if (equation.lhs.toLowerCase() === 'r') {
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
        const explicitMatch = equation.lhs.toLowerCase() === dependentVar.toLowerCase() || /^(y|f\(x\))$/i.test(equation.lhs);

        if (explicitMatch) {
            return {
                family: 'explicit',
                lhs: equation.lhs,
                rhs: equation.rhs,
                independentVar: explicitVars[0] || coordVars[0],
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

        if (equation && equation.lhs.toLowerCase() === 'r') {
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

        return {
            family: 'surface-explicit',
            lhs: equation ? equation.lhs : 'z',
            rhs: equation ? equation.rhs : text,
            surfaceVars: inferCoordinateVariables({
                explicitVars,
                rangeNames,
                exprVars,
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

        if (equation && (equation.lhs.toLowerCase() === 'r' || expressionUsesAnySymbol(text, ['theta']))) {
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
            const explicitMatch = equation.lhs.toLowerCase() === dependentVar.toLowerCase() || /^(y|f\(x\))$/i.test(equation.lhs);
            if (explicitMatch) {
                return {
                    family: 'curve-explicit-2d',
                    lhs: equation.lhs,
                    rhs: equation.rhs,
                    independentVar: explicitVars[0] || coordVars[0],
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

    if (equation && (equation.lhs.toLowerCase() === 'r' || expressionUsesAnySymbol(text, ['theta']))) {
        if (equation.lhs.toLowerCase() === 'r') {
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
        const explicitCurveMatch = equation.lhs.toLowerCase() === dependentVar.toLowerCase() || /^(y|f\(x\))$/i.test(equation.lhs);
        const mentionsZ = /\bz\b/.test(text) || coordVars3.includes(equation.lhs);

        if (equation.lhs.toLowerCase() === 'z') {
            return {
                family: 'surface-explicit',
                lhs: equation.lhs,
                rhs: equation.rhs,
                surfaceVars: coordVars2,
                coordSystem: inferCoordinateSystem(explicitVars, text)
            };
        }

        if (explicitCurveMatch && !mentionsZ) {
            return {
                family: 'curve-explicit-2d',
                lhs: equation.lhs,
                rhs: equation.rhs,
                independentVar: explicitVars[0] || coordVars2[0],
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
