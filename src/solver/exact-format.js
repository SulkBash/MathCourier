const math = require('../math');

const ZERO_EPSILON = 1e-10;

function gcd(a, b) {
    let x = Math.abs(Math.trunc(a));
    let y = Math.abs(Math.trunc(b));
    while (y !== 0) {
        const remainder = x % y;
        x = y;
        y = remainder;
    }
    return x || 1;
}

function lcm(a, b) {
    if (a === 0 || b === 0) {
        return 0;
    }
    return Math.abs(a * b) / gcd(a, b);
}

function normalizeRealNumber(value, epsilon = ZERO_EPSILON) {
    if (!Number.isFinite(value)) {
        return value;
    }

    if (Math.abs(value) < epsilon) {
        return 0;
    }

    const rounded = Math.round(value);
    if (Math.abs(value - rounded) < epsilon) {
        return rounded;
    }

    return value;
}

function formatDecimalTex(value, precision = 12) {
    const normalized = normalizeRealNumber(value);
    const formatted = math.format(normalized, {
        precision,
        lowerExp: -4,
        upperExp: 12
    });

    try {
        return math.parse(formatted).toTex();
    } catch (_) {
        return formatted;
    }
}

function approximateFraction(value, options = {}) {
    const {
        maxDenominator = 64,
        tolerance = 1e-8
    } = options;

    if (!Number.isFinite(value)) {
        return null;
    }

    const normalized = normalizeRealNumber(value, tolerance);
    if (normalized === 0) {
        return { sign: 1, numerator: 0, denominator: 1 };
    }

    const sign = normalized < 0 ? -1 : 1;
    const absoluteValue = Math.abs(normalized);
    let best = null;

    for (let denominator = 1; denominator <= maxDenominator; denominator++) {
        const numerator = Math.round(absoluteValue * denominator);
        const approximation = numerator / denominator;
        const error = Math.abs(absoluteValue - approximation);

        if (!best || error < best.error) {
            best = { numerator, denominator, error };
        }

        if (error <= tolerance) {
            break;
        }
    }

    if (!best || best.error > tolerance) {
        return null;
    }

    const divisor = gcd(best.numerator, best.denominator);
    return {
        sign,
        numerator: best.numerator / divisor,
        denominator: best.denominator / divisor
    };
}

function formatFractionTex(fraction) {
    if (!fraction || fraction.numerator === 0) {
        return '0';
    }

    const signPrefix = fraction.sign < 0 ? '-' : '';
    if (fraction.denominator === 1) {
        return `${signPrefix}${fraction.numerator}`;
    }

    return `${signPrefix}\\frac{${fraction.numerator}}{${fraction.denominator}}`;
}

function formatExactNumberTex(value, options = {}) {
    const {
        maxDenominator = 64,
        tolerance = 1e-8,
        precision = 12
    } = options;

    if (!Number.isFinite(value)) {
        if (value === Infinity) return '\\infty';
        if (value === -Infinity) return '-\\infty';
        return '\\text{NaN}';
    }

    const normalized = normalizeRealNumber(value, tolerance);
    if (Number.isInteger(normalized)) {
        return String(normalized);
    }

    const fraction = approximateFraction(normalized, { maxDenominator, tolerance });
    if (fraction && fraction.denominator !== 1) {
        return formatFractionTex(fraction);
    }

    return formatDecimalTex(normalized, precision);
}

function formatExactScalarTex(value, options = {}) {
    if (typeof value === 'number') {
        return formatExactNumberTex(value, options);
    }

    if (value && value.isComplex) {
        const realPart = normalizeRealNumber(value.re, options.tolerance || ZERO_EPSILON);
        const imaginaryPart = normalizeRealNumber(value.im, options.tolerance || ZERO_EPSILON);

        if (imaginaryPart === 0) {
            return formatExactNumberTex(realPart, options);
        }

        const realTex = formatExactNumberTex(realPart, options);
        const imagMagnitude = Math.abs(imaginaryPart);
        const imagTex = imagMagnitude === 1
            ? 'i'
            : `${formatExactNumberTex(imagMagnitude, options)}i`;
        const sign = imaginaryPart >= 0 ? '+' : '-';
        return `${realTex} ${sign} ${imagTex}`;
    }

    try {
        const formatted = math.format(value, {
            precision: options.precision || 12,
            lowerExp: -4,
            upperExp: 12
        });
        return math.parse(formatted).toTex();
    } catch (_) {
        return String(value);
    }
}

function toRealScalar(value, epsilon = ZERO_EPSILON) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return normalizeRealNumber(value, epsilon);
    }

    if (value && value.isComplex && Math.abs(value.im) < epsilon) {
        return normalizeRealNumber(value.re, epsilon);
    }

    return null;
}

function simplifyRealVectorDirection(vector, options = {}) {
    const {
        tolerance = 1e-6,
        maxDenominator = 16,
        maxCoefficient = 64
    } = options;

    if (!Array.isArray(vector) || vector.length === 0) {
        return null;
    }

    const realValues = [];
    for (const entry of vector) {
        const scalar = toRealScalar(entry, tolerance);
        if (scalar === null) {
            return null;
        }
        realValues.push(scalar);
    }

    const pivot = realValues.find((value) => Math.abs(value) > tolerance);
    if (pivot === undefined) {
        return null;
    }

    const ratios = [];
    for (const value of realValues) {
        if (Math.abs(value) <= tolerance) {
            ratios.push({ sign: 1, numerator: 0, denominator: 1 });
            continue;
        }

        const fraction = approximateFraction(value / pivot, { maxDenominator, tolerance });
        if (!fraction) {
            return null;
        }
        ratios.push(fraction);
    }

    let commonDenominator = 1;
    for (const ratio of ratios) {
        commonDenominator = lcm(commonDenominator, ratio.denominator);
    }

    let integerVector = ratios.map((ratio) =>
        ratio.sign * ratio.numerator * (commonDenominator / ratio.denominator)
    );

    const nonZeroEntries = integerVector.filter((value) => value !== 0);
    if (nonZeroEntries.length === 0) {
        return null;
    }

    const divisor = nonZeroEntries.reduce((acc, value) => gcd(acc, value), Math.abs(nonZeroEntries[0]));
    integerVector = integerVector.map((value) => value / divisor);

    const firstNonZero = integerVector.find((value) => value !== 0);
    if (firstNonZero < 0) {
        integerVector = integerVector.map((value) => -value);
    }

    if (Math.max(...integerVector.map((value) => Math.abs(value))) > maxCoefficient) {
        return null;
    }

    return integerVector;
}

module.exports = {
    approximateFraction,
    formatExactNumberTex,
    formatExactScalarTex,
    formatFractionTex,
    normalizeRealNumber,
    simplifyRealVectorDirection,
    toRealScalar
};
