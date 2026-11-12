const math = require('../math');
const { splitTopLevel, buildLatex } = require('../utils');
const { formatExactScalarTex, simplifyRealVectorDirection } = require('./exact-format');

function placeholderLabel(index) {
    let label = '';
    let value = index;

    do {
        label = String.fromCharCode(65 + (value % 26)) + label;
        value = Math.floor(value / 26) - 1;
    } while (value >= 0);

    return `MAT${label}`;
}

function isCollection(value) {
    return Array.isArray(value) || (value && value.isMatrix);
}

function normalizeNumber(value) {
    if (!Number.isFinite(value)) {
        return value;
    }

    if (value === 0) {
        return 0;
    }

    const rounded = Math.round(value);
    const roundingNoise = Number.EPSILON * Math.max(1, Math.abs(value)) * 4;
    if (rounded !== 0 && Math.abs(value - rounded) <= roundingNoise) {
        return rounded;
    }

    return value;
}

function normalizeScalar(value) {
    if (typeof value === 'number') {
        return normalizeNumber(value);
    }

    if (value && value.isComplex) {
        const re = normalizeNumber(value.re);
        const im = normalizeNumber(value.im);
        if (im === 0) {
            return re;
        }
        return math.complex(re, im);
    }

    return value;
}

function normalizeMatrixValue(matrixLike) {
    return math.matrix(toMatrixRows(matrixLike).map((row) => row.map(normalizeScalar)));
}

function scalarMagnitude(value) {
    try {
        const absValue = math.abs(value);
        if (typeof absValue === 'number') {
            return absValue;
        }
        if (absValue && typeof absValue.toNumber === 'function') {
            return absValue.toNumber();
        }
        return Number(absValue);
    } catch (_) {
        return Number.NaN;
    }
}

function toMatrixRows(matrixLike, options = {}) {
    const { allowVector = false } = options;
    const raw = matrixLike && matrixLike.isMatrix
        ? (typeof matrixLike.toArray === 'function' ? matrixLike.toArray() : matrixLike.valueOf())
        : matrixLike;

    if (!Array.isArray(raw)) {
        throw new Error('Expected a matrix result.');
    }

    if (raw.length === 0) {
        return [];
    }

    if (Array.isArray(raw[0])) {
        return raw.map((row) => {
            if (!Array.isArray(row)) {
                throw new Error('Expected a rectangular matrix.');
            }
            return row;
        });
    }

    if (allowVector) {
        return raw.map((entry) => [entry]);
    }

    throw new Error('Expected a 2D matrix result.');
}

function formatScalarTex(value) {
    const normalized = normalizeScalar(value);
    return formatExactScalarTex(normalized, {
        maxDenominator: 64,
        tolerance: 1e-8,
        precision: 12
    });
}

function formatMatrixTexFromRows(rows) {
    const body = rows
        .map((row) => row.map((entry) => formatScalarTex(entry)).join(' & '))
        .join(' \\\\ ');

    return `\\begin{bmatrix} ${body} \\end{bmatrix}`;
}

function formatMatrixTex(matrixLike, options = {}) {
    return formatMatrixTexFromRows(toMatrixRows(matrixLike, options));
}

function replacePlaceholders(tex, literalMap) {
    let output = tex;
    for (const [placeholder, matrixTex] of literalMap.entries()) {
        output = output.split(placeholder).join(matrixTex);
    }
    return output;
}

function formatNodeTex(node, literalMap) {
    try {
        return replacePlaceholders(node.toTex(), literalMap);
    } catch (_) {
        return replacePlaceholders(node.toString(), literalMap);
    }
}

function parseMatrixLiteral(literal) {
    if (!literal.startsWith('[') || !literal.endsWith(']')) {
        throw new Error(`Invalid matrix literal "${literal}". Use [a, b; c, d].`);
    }

    const inner = literal.slice(1, -1).trim();
    if (!inner) {
        throw new Error('Matrix literal cannot be empty.');
    }

    const rowTexts = splitTopLevel(inner, ';');
    if (rowTexts.length === 0) {
        throw new Error(`Invalid matrix literal "${literal}".`);
    }

    const valueRows = [];
    const texRows = [];
    let expectedColumns = null;

    rowTexts.forEach((rowText, rowIndex) => {
        const columnTexts = splitTopLevel(rowText, ',');
        if (columnTexts.length === 0) {
            throw new Error(`Row ${rowIndex + 1} is empty in matrix literal "${literal}".`);
        }

        if (expectedColumns === null) {
            expectedColumns = columnTexts.length;
        } else if (columnTexts.length !== expectedColumns) {
            throw new Error('Matrix rows must all have the same number of columns.');
        }

        const valueRow = [];
        const texRow = [];

        columnTexts.forEach((cellText, columnIndex) => {
            let node;
            try {
                node = math.parse(cellText);
            } catch (err) {
                throw new Error(`Could not parse matrix entry (${rowIndex + 1}, ${columnIndex + 1}): ${err.message}`);
            }

            let value;
            try {
                value = node.compile().evaluate();
            } catch (err) {
                throw new Error(`Could not evaluate matrix entry (${rowIndex + 1}, ${columnIndex + 1}): ${err.message}`);
            }

            if (isCollection(value)) {
                throw new Error('Matrix entries must evaluate to scalar values.');
            }

            valueRow.push(value);
            texRow.push(node.toTex());
        });

        valueRows.push(valueRow);
        texRows.push(texRow);
    });

    return {
        value: math.matrix(valueRows),
        latex: `\\begin{bmatrix} ${texRows.map((row) => row.join(' & ')).join(' \\\\ ')} \\end{bmatrix}`
    };
}

function extractMatrixLiterals(input) {
    const matrices = [];
    const scope = {};
    const latexMap = new Map();
    let transformed = '';

    for (let index = 0; index < input.length; index++) {
        const char = input[index];
        if (char !== '[') {
            transformed += char;
            continue;
        }

        let depth = 0;
        let end = -1;
        for (let cursor = index; cursor < input.length; cursor++) {
            if (input[cursor] === '[') {
                depth++;
            } else if (input[cursor] === ']') {
                depth--;
                if (depth === 0) {
                    end = cursor;
                    break;
                }
            }
        }

        if (end === -1) {
            throw new Error('Unclosed matrix literal. Make sure every "[" has a matching "]".');
        }

        const literal = input.slice(index, end + 1);
        const parsed = parseMatrixLiteral(literal);
        const placeholder = placeholderLabel(matrices.length);

        matrices.push(parsed);
        scope[placeholder] = parsed.value;
        latexMap.set(placeholder, parsed.latex);
        transformed += placeholder;
        index = end;
    }

    return {
        matrices,
        scope,
        latexMap,
        expression: transformed.trim()
    };
}

function computeRref(matrixLike) {
    const rows = toMatrixRows(matrixLike).map((row) => [...row]);
    if (rows.length === 0 || rows[0].length === 0) {
        throw new Error('RREF requires a non-empty matrix.');
    }

    const rowCount = rows.length;
    const columnCount = rows[0].length;
    // Initial entries are meaningful even when tiny. Track error introduced by
    // row operations so cancellation noise can be distinguished from input.
    const errors = rows.map((row) => row.map(() => 0));
    const roundoff = Number.EPSILON * 4;
    const isEffectivelyZero = (value, error) => scalarMagnitude(value) <= error;
    let lead = 0;

    for (let rowIndex = 0; rowIndex < rowCount && lead < columnCount; rowIndex++) {
        let pivotRow = rowIndex;
        let bestMagnitude = 0;

        for (let candidate = rowIndex; candidate < rowCount; candidate++) {
            const magnitude = scalarMagnitude(rows[candidate][lead]);
            if (Number.isFinite(magnitude) && magnitude > bestMagnitude &&
                !isEffectivelyZero(rows[candidate][lead], errors[candidate][lead])) {
                bestMagnitude = magnitude;
                pivotRow = candidate;
            }
        }

        if (bestMagnitude === 0) {
            lead++;
            rowIndex--;
            continue;
        }

        if (pivotRow !== rowIndex) {
            const tmp = rows[rowIndex];
            rows[rowIndex] = rows[pivotRow];
            rows[pivotRow] = tmp;
            [errors[rowIndex], errors[pivotRow]] = [errors[pivotRow], errors[rowIndex]];
        }

        const pivotValue = rows[rowIndex][lead];
        const pivotMagnitude = scalarMagnitude(pivotValue);
        const pivotError = errors[rowIndex][lead];
        rows[rowIndex] = rows[rowIndex].map((entry, columnIndex) => {
            const quotient = math.divide(entry, pivotValue);
            const quotientMagnitude = scalarMagnitude(quotient);
            errors[rowIndex][columnIndex] =
                (errors[rowIndex][columnIndex] + quotientMagnitude * pivotError) / pivotMagnitude +
                roundoff * quotientMagnitude;
            return quotient;
        });
        rows[rowIndex][lead] = 1;
        errors[rowIndex][lead] = 0;

        for (let otherRow = 0; otherRow < rowCount; otherRow++) {
            if (otherRow === rowIndex) {
                continue;
            }

            const factor = rows[otherRow][lead];
            const factorError = errors[otherRow][lead];
            if (isEffectivelyZero(factor, factorError)) {
                rows[otherRow][lead] = 0;
                errors[otherRow][lead] = 0;
                continue;
            }

            rows[otherRow] = rows[otherRow].map((entry, columnIndex) => {
                const pivotEntry = rows[rowIndex][columnIndex];
                const product = math.multiply(factor, pivotEntry);
                const adjusted = math.subtract(entry, product);
                errors[otherRow][columnIndex] +=
                    scalarMagnitude(factor) * errors[rowIndex][columnIndex] +
                    scalarMagnitude(pivotEntry) * factorError +
                    roundoff * (scalarMagnitude(entry) + scalarMagnitude(product));
                return adjusted;
            });
            rows[otherRow][lead] = 0;
            errors[otherRow][lead] = 0;
        }

        lead++;
    }

    return math.matrix(rows.map((row, index) => row.map((entry, columnIndex) =>
        isEffectivelyZero(entry, errors[index][columnIndex]) ? 0 : normalizeScalar(entry)
    )));
}

function computeEigenDecomposition(matrixLike) {
    const rows = toMatrixRows(matrixLike);
    if (rows.length === 0 || rows.length !== rows[0].length) {
        throw new Error('Eigenvalues require a square matrix.');
    }

    const result = math.eigs(math.matrix(rows), { eigenvectors: true });
    return {
        values: Array.isArray(result.values)
            ? result.values.map(normalizeScalar)
            : toMatrixRows(result.values, { allowVector: true }).flat().map(normalizeScalar),
        eigenvectors: (result.eigenvectors || []).map((entry) => ({
            value: normalizeScalar(entry.value),
            vector: (() => {
                const normalizedVector = toMatrixRows(entry.vector, { allowVector: true }).flat().map(normalizeScalar);
                return simplifyRealVectorDirection(normalizedVector, {
                    tolerance: 1e-6,
                    maxDenominator: 16,
                    maxCoefficient: 64
                }) || normalizedVector;
            })()
        }))
    };
}

function isEigenResult(value) {
    return Boolean(
        value &&
        typeof value === 'object' &&
        Array.isArray(value.values) &&
        Array.isArray(value.eigenvectors)
    );
}

function formatEigenLatex(argumentTex, eigenResult) {
    const lines = [`A &= ${argumentTex}`];

    eigenResult.values.forEach((value, index) => {
        lines.push(`\\lambda_{${index + 1}} &= ${formatScalarTex(value)}`);
    });

    eigenResult.eigenvectors.forEach((entry, index) => {
        lines.push(`\\mathbf{v}_{${index + 1}} &= ${formatMatrixTex(entry.vector, { allowVector: true })}`);
    });

    return buildLatex(lines);
}

function formatResultLatex(node, literalMap, result) {
    const rootFunctionName = node && node.isFunctionNode && node.fn && node.fn.isSymbolNode
        ? String(node.fn.name || '').toLowerCase()
        : null;

    if (rootFunctionName === 'eigen' || rootFunctionName === 'eig' || rootFunctionName === 'eigs') {
        const argumentTex = node.args && node.args[0]
            ? formatNodeTex(node.args[0], literalMap)
            : 'A';
        return formatEigenLatex(argumentTex, result);
    }

    if (rootFunctionName === 'rref' && node.args && node.args[0]) {
        const argumentTex = formatNodeTex(node.args[0], literalMap);
        return buildLatex([
            `\\operatorname{rref}\\left(${argumentTex}\\right) &= ${formatMatrixTex(result)}`
        ]);
    }

    if (rootFunctionName === 'det' && node.args && node.args[0]) {
        const argumentTex = formatNodeTex(node.args[0], literalMap);
        return buildLatex([
            `\\det\\left(${argumentTex}\\right) &= ${formatScalarTex(result)}`
        ]);
    }

    if ((rootFunctionName === 'inv' || rootFunctionName === 'inverse') && node.args && node.args[0]) {
        const argumentTex = formatNodeTex(node.args[0], literalMap);
        return buildLatex([
            `\\left(${argumentTex}\\right)^{-1} &= ${formatMatrixTex(result)}`
        ]);
    }

    const expressionTex = formatNodeTex(node, literalMap);
    if (isCollection(result)) {
        return buildLatex([
            `${expressionTex} &= ${formatMatrixTex(result)}`
        ]);
    }

    return buildLatex([
        `${expressionTex} &= ${formatScalarTex(result)}`
    ]);
}

function solveMatrixExpression(inputStr) {
    const input = String(inputStr || '').trim();
    if (!input) {
        return { success: false, error: 'No matrix expression provided. Use matrices like [1, 2; 3, 4].' };
    }

    try {
        const extracted = extractMatrixLiterals(input);
        if (extracted.matrices.length === 0) {
            return { success: false, error: 'No matrix literal found. Use matrices like [1, 2; 3, 4].' };
        }

        if (!extracted.expression) {
            return { success: false, error: 'Matrix input is incomplete. Provide an operation like det([1, 2; 3, 4]).' };
        }

        const node = math.parse(extracted.expression);
        const result = node.compile().evaluate({
            ...extracted.scope,
            eigen: computeEigenDecomposition,
            eig: computeEigenDecomposition,
            eigs: computeEigenDecomposition,
            rref: computeRref,
            inverse: math.inv
        });

        if (result === undefined) {
            return { success: false, error: 'Matrix expression did not produce a result.' };
        }

        const normalizedResult = isCollection(result)
            ? normalizeMatrixValue(result)
            : (isEigenResult(result)
                ? {
                    values: result.values.map(normalizeScalar),
                    eigenvectors: result.eigenvectors.map((entry) => ({
                        value: normalizeScalar(entry.value),
                        vector: entry.vector.map(normalizeScalar)
                    }))
                }
                : normalizeScalar(result));

        return {
            success: true,
            latex: formatResultLatex(node, extracted.latexMap, normalizedResult)
        };
    } catch (err) {
        return {
            success: false,
            error: `Matrix error: ${err.message}`
        };
    }
}

module.exports = {
    solveMatrixExpression,
    computeRref,
    computeEigenDecomposition
};
