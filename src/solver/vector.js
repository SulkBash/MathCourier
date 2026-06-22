const math = require('../math');
const { splitTopLevel, buildLatex } = require('../utils');
const { extractVariables } = require('./equations');

const VALID_VAR_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const DEFAULT_COORDS = ['x', 'y', 'z'];
const VARIABLE_PREFERENCE = ['x', 'y', 'z', 'r', 'theta', 'phi', 'u', 'v', 'w', 's', 't'];


function orderVariables(variableNames) {
    const seen = new Set();
    return variableNames
        .filter(Boolean)
        .filter((name) => {
            if (seen.has(name)) return false;
            seen.add(name);
            return true;
        })
        .sort((a, b) => {
            const aIndex = VARIABLE_PREFERENCE.indexOf(a);
            const bIndex = VARIABLE_PREFERENCE.indexOf(b);
            const aRank = aIndex === -1 ? VARIABLE_PREFERENCE.length : aIndex;
            const bRank = bIndex === -1 ? VARIABLE_PREFERENCE.length : bIndex;

            if (aRank !== bRank) {
                return aRank - bRank;
            }

            return a.localeCompare(b);
        });
}

function validateVariables(variableNames, label) {
    if (!Array.isArray(variableNames) || variableNames.length === 0) {
        throw new Error(`${label} requires at least one coordinate variable.`);
    }

    const normalized = variableNames.map((name) => {
        const trimmed = String(name || '').trim();
        if (!VALID_VAR_RE.test(trimmed)) {
            throw new Error(`Invalid variable name "${name}". Use simple names like x, y, or z.`);
        }
        return trimmed;
    });

    if (new Set(normalized).size !== normalized.length) {
        throw new Error(`${label} variables must be unique.`);
    }

    return normalized;
}

function parseNode(exprStr, label) {
    try {
        return math.parse(exprStr.trim());
    } catch (err) {
        throw new Error(`${label} parsing error: ${err.message}`);
    }
}

function formatNodeLatex(node) {
    try {
        return math.simplify(node).toTex();
    } catch (err) {
        return node.toTex();
    }
}

function formatTupleLatex(nodes) {
    return `\\left\\langle ${nodes.map((node) => formatNodeLatex(node)).join(', ')} \\right\\rangle`;
}

function combineNodes(leftNode, operator, rightNode) {
    return math.simplify(`(${leftNode.toString()}) ${operator} (${rightNode.toString()})`);
}

function sumNodes(nodes) {
    if (nodes.length === 0) {
        return math.parse('0');
    }

    return math.simplify(nodes.map((node) => `(${node.toString()})`).join(' + '));
}

function findLeadingTupleEnd(text) {
    if (!text.startsWith('(')) {
        return -1;
    }

    let depth = 0;
    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (char === '(') {
            depth++;
        } else if (char === ')') {
            depth--;
            if (depth === 0) {
                return index;
            }
        }
    }

    return -1;
}

function inferGradientVariables(exprNode) {
    const inferred = orderVariables(extractVariables(exprNode));
    return inferred.length > 0 ? inferred : ['x'];
}

function inferVectorVariables(componentNodes, dimension, label) {
    const usedVariables = new Set();
    for (const node of componentNodes) {
        const names = extractVariables(node);
        for (const name of names) {
            usedVariables.add(name);
        }
    }

    const inferred = orderVariables(Array.from(usedVariables));

    if (inferred.length === dimension) {
        return inferred;
    }

    if (inferred.length > dimension) {
        return inferred.slice(0, dimension);
    }

    if (inferred.length === 0) {
        return DEFAULT_COORDS.slice(0, dimension);
    }

    if (inferred.every((name) => DEFAULT_COORDS.includes(name))) {
        const filled = [...inferred];
        for (const defaultName of DEFAULT_COORDS) {
            if (filled.length === dimension) {
                break;
            }
            if (!filled.includes(defaultName)) {
                filled.push(defaultName);
            }
        }
        return filled;
    }

    throw new Error(
        `Could not infer ${dimension} coordinate variables for ${label}. ` +
        `Specify them explicitly, for example: ${dimension === 2 ? '(F_1, F_2), x, y' : '(F_1, F_2, F_3), x, y, z'}.`
    );
}

function parseGradientInput(inputStr) {
    const trimmed = String(inputStr || '').trim();
    if (!trimmed) {
        throw new Error('No scalar field provided. Use: !grad <expression> [variables].');
    }

    const parts = splitTopLevel(trimmed);
    return {
        expr: parts[0] || '',
        variables: parts.slice(1).map((part) => part.trim()).filter(Boolean)
    };
}

function parseVectorFieldInput(inputStr, label) {
    const trimmed = String(inputStr || '').trim();
    if (!trimmed) {
        throw new Error(`No vector field provided. Use: !${label.toLowerCase()} (F_1, F_2[, F_3]) [variables].`);
    }

    const tupleEnd = findLeadingTupleEnd(trimmed);
    if (tupleEnd === -1) {
        throw new Error(`${label} expects a vector field written as (F_1, F_2) or (F_1, F_2, F_3).`);
    }

    const tupleText = trimmed.slice(0, tupleEnd + 1);
    const remainder = trimmed.slice(tupleEnd + 1).trim();
    const varsText = remainder ? remainder.replace(/^,\s*/, '') : '';

    if (remainder && varsText === remainder) {
        throw new Error(`${label} variables must come after a comma, for example: (x^2, y^2), x, y.`);
    }

    const inner = tupleText.slice(1, -1).trim();
    const componentExprs = splitTopLevel(inner);

    if (componentExprs.length < 2 || componentExprs.length > 3) {
        throw new Error(`${label} only supports 2D or 3D vector fields.`);
    }

    return {
        componentExprs,
        componentNodes: componentExprs.map((expr, index) => parseNode(expr, `${label} component ${index + 1}`)),
        variables: varsText ? splitTopLevel(varsText).map((part) => part.trim()).filter(Boolean) : []
    };
}

function solveGradient(inputStr) {
    try {
        const parsed = parseGradientInput(inputStr);
        const exprNode = parseNode(parsed.expr, 'Gradient input');
        const variables = parsed.variables.length > 0 ? validateVariables(parsed.variables, 'Gradient') : inferGradientVariables(exprNode);

        if (variables.length > 3) {
            return { success: false, error: 'Gradient currently supports up to three coordinate variables.' };
        }

        const resultNodes = variables.map((variable) => math.simplify(math.derivative(exprNode, variable)));

        return {
            success: true,
            variables,
            dimension: variables.length,
            latex: buildLatex([
                `f(${variables.join(', ')}) &= ${formatNodeLatex(exprNode)}`,
                `\\nabla f &= ${formatTupleLatex(resultNodes)}`
            ])
        };
    } catch (err) {
        return { success: false, error: `Gradient error: ${err.message}` };
    }
}

function solveLaplacian(inputStr) {
    try {
        const parsed = parseGradientInput(inputStr);
        const exprNode = parseNode(parsed.expr, 'Laplacian input');
        const variables = parsed.variables.length > 0 ? validateVariables(parsed.variables, 'Laplacian') : inferGradientVariables(exprNode);

        if (variables.length > 3) {
            return { success: false, error: 'Laplacian currently supports up to three coordinate variables.' };
        }

        const secondDerivativeNodes = variables.map((variable) => {
            const firstDerivative = math.derivative(exprNode, variable);
            return math.simplify(math.derivative(firstDerivative, variable));
        });
        const laplacianNode = sumNodes(secondDerivativeNodes);

        return {
            success: true,
            variables,
            dimension: variables.length,
            latex: buildLatex([
                `f(${variables.join(', ')}) &= ${formatNodeLatex(exprNode)}`,
                `\\nabla^2 f &= ${formatNodeLatex(laplacianNode)}`
            ])
        };
    } catch (err) {
        return { success: false, error: `Laplacian error: ${err.message}` };
    }
}

function solveDivergence(inputStr) {
    try {
        const parsed = parseVectorFieldInput(inputStr, 'Divergence');
        const dimension = parsed.componentNodes.length;
        const variables = parsed.variables.length > 0
            ? validateVariables(parsed.variables, 'Divergence')
            : inferVectorVariables(parsed.componentNodes, dimension, 'divergence');

        if (variables.length !== dimension) {
            return {
                success: false,
                error: `Divergence expects ${dimension} coordinate variable${dimension === 1 ? '' : 's'} for a ${dimension}D field.`
            };
        }

        const derivativeTerms = parsed.componentNodes.map((node, index) => math.derivative(node, variables[index]));
        const divergenceNode = sumNodes(derivativeTerms);

        return {
            success: true,
            variables,
            dimension,
            latex: buildLatex([
                `\\mathbf{F}(${variables.join(', ')}) &= ${formatTupleLatex(parsed.componentNodes)}`,
                `\\nabla \\cdot \\mathbf{F} &= ${formatNodeLatex(divergenceNode)}`
            ])
        };
    } catch (err) {
        return { success: false, error: `Divergence error: ${err.message}` };
    }
}

function solveCurl(inputStr) {
    try {
        const parsed = parseVectorFieldInput(inputStr, 'Curl');
        const dimension = parsed.componentNodes.length;
        const variables = parsed.variables.length > 0
            ? validateVariables(parsed.variables, 'Curl')
            : inferVectorVariables(parsed.componentNodes, dimension, 'curl');

        if (variables.length !== dimension) {
            return {
                success: false,
                error: `Curl expects ${dimension} coordinate variable${dimension === 1 ? '' : 's'} for a ${dimension}D field.`
            };
        }

        let curlLatex;
        if (dimension === 2) {
            const [pNode, qNode] = parsed.componentNodes;
            const [xVar, yVar] = variables;
            const scalarCurl = combineNodes(math.derivative(qNode, xVar), '-', math.derivative(pNode, yVar));
            curlLatex = formatNodeLatex(scalarCurl);
        } else {
            const [f1, f2, f3] = parsed.componentNodes;
            const [xVar, yVar, zVar] = variables;

            const curlComponents = [
                combineNodes(math.derivative(f3, yVar), '-', math.derivative(f2, zVar)),
                combineNodes(math.derivative(f1, zVar), '-', math.derivative(f3, xVar)),
                combineNodes(math.derivative(f2, xVar), '-', math.derivative(f1, yVar))
            ];
            curlLatex = formatTupleLatex(curlComponents);
        }

        return {
            success: true,
            variables,
            dimension,
            latex: buildLatex([
                `\\mathbf{F}(${variables.join(', ')}) &= ${formatTupleLatex(parsed.componentNodes)}`,
                `\\nabla \\times \\mathbf{F} &= ${curlLatex}`
            ])
        };
    } catch (err) {
        return { success: false, error: `Curl error: ${err.message}` };
    }
}

module.exports = {
    solveGradient,
    solveLaplacian,
    solveDivergence,
    solveCurl,
    parseGradientInput,
    parseVectorFieldInput
};
