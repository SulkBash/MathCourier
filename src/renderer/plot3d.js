const math = require('../math');
const config = require('../../config');
const katexModule = require('./katex');
const { splitByTopLevelCommas } = require('./plot');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ZERO_TOLERANCE = 1e-9;
const MAX_CONCURRENT_PLOT3D = Math.max(1, Number(config.bot?.plot3dMaxConcurrency) || 3);
const DEFAULT_ANIMATION_FRAMES = Math.max(6, Number(config.bot?.plot3dAnimationFrames) || 12);
const DEFAULT_ANIMATION_FPS = Math.max(4, Number(config.bot?.plot3dAnimationFps) || 10);
const DEFAULT_ANIMATION_BASE_ANGLE_DEGREES = Number(config.bot?.plot3dAnimationBaseAngleDegrees) || 45;
const DEFAULT_ANIMATION_SWING_DEGREES = Math.max(5, Math.min(44, Number(config.bot?.plot3dAnimationSwingDegrees) || 30));
const DEFAULT_ANIMATION_CAMERA_RADIUS = Math.max(0.8, Number(config.bot?.plot3dAnimationCameraRadius) || 1.6);
const DEFAULT_ANIMATION_CAMERA_HEIGHT = Math.max(0.4, Number(config.bot?.plot3dAnimationCameraHeight) || 1.1);

let activePlot3dJobs = 0;
const plot3dWaitQueue = [];

function createPlot3dRelease() {
    let released = false;

    return () => {
        if (released) {
            return;
        }
        released = true;

        const next = plot3dWaitQueue.shift();
        if (next) {
            next(createPlot3dRelease());
            return;
        }

        activePlot3dJobs = Math.max(0, activePlot3dJobs - 1);
    };
}

async function acquirePlot3dSlot() {
    if (activePlot3dJobs < MAX_CONCURRENT_PLOT3D) {
        activePlot3dJobs += 1;
        return createPlot3dRelease();
    }

    return new Promise((resolve) => {
        plot3dWaitQueue.push(resolve);
    });
}

function degreesToRadians(degrees) {
    return (degrees * Math.PI) / 180;
}

function rotateX(point, angle) {
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    return {
        x: point.x,
        y: point.y * cosA - point.z * sinA,
        z: point.y * sinA + point.z * cosA
    };
}

function rotateY(point, angle) {
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    return {
        x: point.x * cosA + point.z * sinA,
        y: point.y,
        z: -point.x * sinA + point.z * cosA
    };
}

function rotateZ(point, angle) {
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    return {
        x: point.x * cosA - point.y * sinA,
        y: point.x * sinA + point.y * cosA,
        z: point.z
    };
}

function rotateAroundAxis(point, axis, angle) {
    if (axis === 'x') {
        return rotateX(point, angle);
    } else if (axis === 'y') {
        return rotateY(point, angle);
    } else {
        return rotateZ(point, angle);
    }
}

function buildCameraForAngle(theta) {
    return {
        eye: {
            x: DEFAULT_ANIMATION_CAMERA_RADIUS * Math.cos(theta),
            y: DEFAULT_ANIMATION_CAMERA_RADIUS * Math.sin(theta),
            z: DEFAULT_ANIMATION_CAMERA_HEIGHT
        },
        up: { x: 0, y: 0, z: 1 },
        center: { x: 0, y: 0, z: 0 }
    };
}

function buildDefaultCamera() {
    return buildCameraForAngle(degreesToRadians(DEFAULT_ANIMATION_BASE_ANGLE_DEGREES));
}

function buildSwingCamera(progress, axis = 'z', customAngle = null) {
    const baseTheta = degreesToRadians(DEFAULT_ANIMATION_BASE_ANGLE_DEGREES);
    const eye_0 = {
        x: DEFAULT_ANIMATION_CAMERA_RADIUS * Math.cos(baseTheta),
        y: DEFAULT_ANIMATION_CAMERA_RADIUS * Math.sin(baseTheta),
        z: DEFAULT_ANIMATION_CAMERA_HEIGHT
    };
    const up_0 = { x: 0, y: 0, z: 1 };

    const swingAngle = customAngle !== null ? customAngle : DEFAULT_ANIMATION_SWING_DEGREES;
    const swingTheta = degreesToRadians(swingAngle);
    const alpha = swingTheta * Math.sin((2 * Math.PI * progress) - (Math.PI / 2));

    return {
        eye: rotateAroundAxis(eye_0, axis, alpha),
        up: rotateAroundAxis(up_0, axis, alpha),
        center: { x: 0, y: 0, z: 0 }
    };
}

function buildOrbitCamera(progress, axis = 'z', customAngle = null) {
    const baseTheta = degreesToRadians(DEFAULT_ANIMATION_BASE_ANGLE_DEGREES);
    const eye_0 = {
        x: DEFAULT_ANIMATION_CAMERA_RADIUS * Math.cos(baseTheta),
        y: DEFAULT_ANIMATION_CAMERA_RADIUS * Math.sin(baseTheta),
        z: DEFAULT_ANIMATION_CAMERA_HEIGHT
    };
    const up_0 = { x: 0, y: 0, z: 1 };

    const maxAngleRad = customAngle !== null ? degreesToRadians(customAngle) : degreesToRadians(360);
    const alpha = maxAngleRad * progress;

    return {
        eye: rotateAroundAxis(eye_0, axis, alpha),
        up: rotateAroundAxis(up_0, axis, alpha),
        center: { x: 0, y: 0, z: 0 }
    };
}

function buildAnimationCamera(progress, mode = 'swing', axis = 'z', customAngle = null) {
    if (mode === 'orbit') {
        return buildOrbitCamera(progress, axis, customAngle);
    }

    return buildSwingCamera(progress, axis, customAngle);
}

function normalizeAnimationIdentifier(identifier) {
    if (!identifier) {
        return null;
    }
    return String(identifier).trim().toLowerCase() || null;
}

function mergeEvalScope(opts, localScope = {}) {
    return Object.assign({}, opts.evalScope || {}, localScope);
}

function cloneDomain(domain) {
    return Array.isArray(domain) ? [...domain] : domain;
}

function clonePlot3dOptions(baseOpts) {
    return {
        ...baseOpts,
        xDomain: cloneDomain(baseOpts.xDomain),
        yDomain: cloneDomain(baseOpts.yDomain),
        zDomain: cloneDomain(baseOpts.zDomain),
        camera: baseOpts.camera
            ? {
                eye: { ...baseOpts.camera.eye },
                up: { ...baseOpts.camera.up },
                center: { ...baseOpts.camera.center }
            }
            : buildDefaultCamera(),
        evalScope: baseOpts.evalScope ? { ...baseOpts.evalScope } : undefined
    };
}

function isTracingLimited(opts, symbolName, value) {
    return opts.tracingVar === symbolName &&
        opts.tracingLimit !== undefined &&
        opts.tracingLimit !== null &&
        typeof value === 'number' &&
        value > opts.tracingLimit;
}

function shouldSkipCartesianPoint(opts, x, y, z) {
    return isTracingLimited(opts, 'x', x) ||
        isTracingLimited(opts, 'y', y) ||
        isTracingLimited(opts, 'z', z);
}

function appendEvolutionLatex(latexText, evolutionVar, evolutionValue) {
    if (!evolutionVar || typeof evolutionValue !== 'number' || !isFinite(evolutionValue)) {
        return latexText;
    }
    return `${latexText}\\quad (${evolutionVar} = ${evolutionValue.toFixed(2)})`;
}

function getPlot3dTraceVariables({ isVectorField, isParametricSurface, isExplicitPolarSurface, isParametricCurve, coordSystem }) {
    if (isParametricSurface) {
        return ['u', 'v'];
    }

    if (isExplicitPolarSurface) {
        return coordSystem === 'spherical' ? ['theta', 'phi'] : ['theta', 'z'];
    }

    if (isParametricCurve) {
        return ['t'];
    }

    if (isVectorField) {
        return ['x', 'y', 'z'];
    }

    return ['x', 'y', 'z'];
}

function getDefaultPlot3dEvolutionVar(expr, traceVars) {
    if (/\bt\b/i.test(expr) && !traceVars.includes('t')) {
        return 't';
    }
    return traceVars[0] || 't';
}

function resolvePlot3dTraceBounds(tracingVar, domainInfo, coordSystem) {
    switch (tracingVar) {
        case 'x':
            return domainInfo.xDomain || null;
        case 'y':
            return domainInfo.yDomain || null;
        case 'z':
            if (domainInfo.parameterDomain2 && coordSystem === 'cylindrical') {
                return domainInfo.parameterDomain2;
            }
            return domainInfo.zDomain || null;
        case 'u':
        case 'theta':
            return domainInfo.parameterDomain1 || null;
        case 'v':
        case 'phi':
            return domainInfo.parameterDomain2 || null;
        case 't':
            return domainInfo.parameterDomain1 || null;
        default:
            return null;
    }
}

function resolvePlot3dDomains({
    customOptions,
    domains,
    graphStyle,
    coordSystem,
    isVectorField,
    isParametricSurface,
    isExplicitPolarSurface,
    isParametricCurve,
    isImplicitEquation,
    hasEvolutionSweep
}) {
    const defaultEvolutionDomain = [0, 2 * Math.PI];
    const defaultXDomain = graphStyle.defaultXDomain || [-10, 10];
    const defaultYDomain = graphStyle.defaultYDomain || [-10, 10];

    if (customOptions.pdeData) {
        return {
            xDomain: customOptions.xDomain,
            yDomain: customOptions.yDomain,
            zDomain: customOptions.zDomain,
            parameterDomain1: null,
            parameterDomain2: null,
            evolutionDomain: null,
            providedDomains: { x: true, y: true, z: true }
        };
    }

    let xDomain;
    let yDomain;
    let zDomain;
    let parameterDomain1 = null;
    let parameterDomain2 = null;
    let evolutionDomain = null;
    const providedDomains = { x: false, y: false, z: false };

    if (isVectorField) {
        xDomain = domains.length >= 1 ? domains[0] : defaultXDomain;
        yDomain = domains.length >= 2 ? domains[1] : [...xDomain];
        zDomain = domains.length >= 3 ? domains[2] : [...xDomain];
        evolutionDomain = hasEvolutionSweep ? (domains.length >= 4 ? domains[3] : defaultEvolutionDomain) : null;
        providedDomains.x = domains.length >= 1;
        providedDomains.y = domains.length >= 2;
        providedDomains.z = domains.length >= 3;
    } else if (isParametricSurface || isExplicitPolarSurface) {
        const defaultU = coordSystem === 'spherical' ? [0, Math.PI] : [0, 2 * Math.PI];
        const defaultV = coordSystem === 'spherical'
            ? [0, 2 * Math.PI]
            : (coordSystem === 'cylindrical' ? [-5, 5] : [0, 2 * Math.PI]);

        parameterDomain1 = domains.length >= 1 ? domains[0] : defaultU;
        parameterDomain2 = domains.length >= 2 ? domains[1] : defaultV;
        evolutionDomain = hasEvolutionSweep ? (domains.length >= 3 ? domains[2] : defaultEvolutionDomain) : null;

        const displayOffset = hasEvolutionSweep ? 3 : 2;
        xDomain = domains.length >= displayOffset + 1 ? domains[displayOffset] : defaultXDomain;
        yDomain = domains.length >= displayOffset + 2 ? domains[displayOffset + 1] : [...xDomain];
        zDomain = domains.length >= displayOffset + 3 ? domains[displayOffset + 2] : [...xDomain];
        providedDomains.x = domains.length >= displayOffset + 1;
        providedDomains.y = domains.length >= displayOffset + 2;
        providedDomains.z = domains.length >= displayOffset + 3;
    } else if (isParametricCurve) {
        parameterDomain1 = domains.length >= 1 ? domains[0] : [0, 2 * Math.PI];
        evolutionDomain = hasEvolutionSweep ? (domains.length >= 2 ? domains[1] : defaultEvolutionDomain) : null;

        const displayOffset = hasEvolutionSweep ? 2 : 1;
        xDomain = domains.length >= displayOffset + 1 ? domains[displayOffset] : defaultXDomain;
        yDomain = domains.length >= displayOffset + 2 ? domains[displayOffset + 1] : [...xDomain];
        zDomain = domains.length >= displayOffset + 3 ? domains[displayOffset + 2] : [...xDomain];
        providedDomains.x = domains.length >= displayOffset + 1;
        providedDomains.y = domains.length >= displayOffset + 2;
        providedDomains.z = domains.length >= displayOffset + 3;
    } else if (isImplicitEquation) {
        xDomain = domains.length >= 1 ? domains[0] : defaultXDomain;
        yDomain = domains.length >= 2 ? domains[1] : defaultYDomain;
        zDomain = domains.length >= 3 ? domains[2] : null;
        evolutionDomain = hasEvolutionSweep ? (domains.length >= 4 ? domains[3] : defaultEvolutionDomain) : null;
        providedDomains.x = domains.length >= 1;
        providedDomains.y = domains.length >= 2;
        providedDomains.z = domains.length >= 3;
    } else {
        xDomain = domains.length >= 1 ? domains[0] : defaultXDomain;
        yDomain = domains.length >= 2 ? domains[1] : defaultYDomain;
        if (hasEvolutionSweep) {
            evolutionDomain = domains.length >= 3 ? domains[2] : defaultEvolutionDomain;
            zDomain = domains.length >= 4 ? domains[3] : null;
            providedDomains.z = domains.length >= 4;
        } else {
            zDomain = domains.length >= 3 ? domains[2] : null;
            providedDomains.z = domains.length >= 3;
        }
        providedDomains.x = domains.length >= 1;
        providedDomains.y = domains.length >= 2;
    }

    return {
        xDomain,
        yDomain,
        zDomain,
        parameterDomain1,
        parameterDomain2,
        evolutionDomain,
        providedDomains
    };
}

// Coerce mathjs result to a plain number
function toReal(val) {
    if (val && typeof val === 'object') {
        if (val.entries && Array.isArray(val.entries)) {
            val = val.entries[val.entries.length - 1];
        }
    }
    if (val && typeof val === 'object') {
        if (val.isComplex) return Math.abs(val.im) < 1e-10 ? val.re : NaN;
        return val.toNumber ? val.toNumber() : NaN;
    }
    return typeof val === 'number' ? val : NaN;
}

// Preprocess expression to insert implicit multiplications for variables
function preprocessExpr(expr) {
    if (!expr) return '';

    const symbols = new Set(['x', 'y', 'z', 'u', 'v', 't']);
    const isIdentifierChar = (char) => /[A-Za-z0-9_]/.test(char);
    let result = '';
    let inQuotes = false;
    let quoteChar = null;

    for (let i = 0; i < expr.length; i++) {
        const char = expr[i];

        if (inQuotes) {
            result += char;
            if (char === '\\' && i + 1 < expr.length) {
                result += expr[i + 1];
                i++;
            } else if (char === quoteChar) {
                inQuotes = false;
                quoteChar = null;
            }
            continue;
        }

        if (char === '"' || char === '\'') {
            inQuotes = true;
            quoteChar = char;
            result += char;
            continue;
        }

        result += char;

        if (!symbols.has(char.toLowerCase())) {
            continue;
        }

        const prevChar = i > 0 ? expr[i - 1] : '';
        if (prevChar && isIdentifierChar(prevChar)) {
            let skip = true;
            let nextIndex = i + 1;
            while (nextIndex < expr.length && /\s/.test(expr[nextIndex])) {
                nextIndex++;
            }
            if (nextIndex < expr.length && symbols.has(expr[nextIndex].toLowerCase())) {
                skip = false;
            }
            if (/\d/.test(prevChar)) {
                skip = false;
            }
            if (skip) {
                continue;
            }
        }

        let nextIndex = i + 1;
        while (nextIndex < expr.length && /\s/.test(expr[nextIndex])) {
            nextIndex++;
        }

        if (nextIndex >= expr.length) {
            continue;
        }

        const nextChar = expr[nextIndex];
        if (symbols.has(nextChar.toLowerCase()) || nextChar === '(') {
            result += '*';
        }
    }

    return result;
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

    const components = splitByTopLevelCommas(trimmed.slice(1, -1))
        .map((component) => component.trim())
        .filter(Boolean);

    if (expectedDimension !== null && components.length !== expectedDimension) {
        return null;
    }

    return components;
}

function parseNamedVectorField(expr) {
    const match = expr.match(/^([A-Za-z][A-Za-z0-9_]*)\(\s*([a-zA-Z0-9_, ]+)\s*\)\s*=\s*(.+)$/);
    if (!match) {
        return null;
    }

    const components = parseVectorTuple(match[3], 3);
    if (!components) {
        return null;
    }

    return {
        name: match[1],
        vars: match[2].split(',').map(v => v.trim().toLowerCase()),
        components
    };
}

function expressionUsesAnySymbol(expr, symbolNames) {
    try {
        const symbolSet = new Set(symbolNames);
        let found = false;
        math.parse(preprocessExpr(expr)).traverse((child) => {
            if (child && child.isSymbolNode && symbolSet.has(child.name)) {
                found = true;
            }
        });
        return found;
    } catch (err) {
        return false;
    }
}

function shouldTreatBareTupleAsVector(components, domainsCount) {
    const hasUV = components.some(c => expressionUsesAnySymbol(c, ['u', 'v']));
    if (hasUV) return false;
    if (domainsCount >= 2) {
        return true;
    }
    return components.some((component) => expressionUsesAnySymbol(component, ['x', 'y', 'z', 'r', 'theta', 'phi']));
}

function getCoordinateSystem(expr, components = null) {
    const exprStr = expr.toLowerCase();
    const compsStr = components ? components.join(' ').toLowerCase() : '';
    
    const namedMatch = expr.match(/^([A-Za-z][A-Za-z0-9_]*)\(\s*([a-zA-Z0-9_, ]+)\s*\)\s*=\s*(.+)$/);
    if (namedMatch) {
        const vars = namedMatch[2].split(',').map(v => v.trim().toLowerCase());
        if (vars.includes('phi') || (vars.includes('theta') && vars.includes('phi'))) {
            return 'spherical';
        }
        if (vars.includes('r') && vars.includes('theta') && vars.includes('z')) {
            return 'cylindrical';
        }
    }
    
    const testStr = exprStr + ' ' + compsStr;
    if (/\bphi\b/i.test(testStr)) {
        return 'spherical';
    }
    // If it contains theta and has no z, default to spherical (like polar coordinates)
    if (/\btheta\b/i.test(testStr) && !/\bz\b/i.test(testStr)) {
        return 'spherical';
    }
    if (/\br\b/i.test(testStr) || /\btheta\b/i.test(testStr)) {
        return 'cylindrical';
    }
    
    return 'cartesian';
}

function sampleVectorField3d(components, opts, coordSystem = 'cartesian') {
    const [xExpr, yExpr, zExpr] = components;
    const xCompiled = math.compile(preprocessExpr(xExpr));
    const yCompiled = math.compile(preprocessExpr(yExpr));
    const zCompiled = math.compile(preprocessExpr(zExpr));

    const [xMin, xMax] = opts.xDomain;
    const [yMin, yMax] = opts.yDomain;
    const [zMin, zMax] = opts.zDomain;

    const steps = 5;
    const xStep = (xMax - xMin) / steps;
    const yStep = (yMax - yMin) / steps;
    const zStep = (zMax - zMin) / steps;

    const points = [];
    let maxMag = 0;

    for (let i = 0; i <= steps; i++) {
        const x = xMin + i * xStep;
        for (let j = 0; j <= steps; j++) {
            const y = yMin + j * yStep;
            for (let k = 0; k <= steps; k++) {
                const z = zMin + k * zStep;
                if (shouldSkipCartesianPoint(opts, x, y, z)) {
                    continue;
                }
                try {
                    let uVal, vVal, wVal;
                    if (coordSystem === 'cylindrical') {
                        const r = Math.sqrt(x*x + y*y);
                        const theta = Math.atan2(y, x);
                        const scope = mergeEvalScope(opts, { r, theta, z });
                        const Fr = toReal(xCompiled.evaluate(scope));
                        const Ftheta = toReal(yCompiled.evaluate(scope));
                        const Fz = toReal(zCompiled.evaluate(scope));
                        
                        uVal = Fr * Math.cos(theta) - Ftheta * Math.sin(theta);
                        vVal = Fr * Math.sin(theta) + Ftheta * Math.cos(theta);
                        wVal = Fz;
                    } else if (coordSystem === 'spherical') {
                        const r = Math.sqrt(x*x + y*y + z*z);
                        const theta = r > ZERO_TOLERANCE ? Math.acos(z / r) : 0;
                        const phi = Math.atan2(y, x);
                        const scope = mergeEvalScope(opts, { r, theta, phi });
                        const Fr = toReal(xCompiled.evaluate(scope));
                        const Ftheta = toReal(yCompiled.evaluate(scope));
                        const Fphi = toReal(zCompiled.evaluate(scope));
                        
                        uVal = Fr * Math.sin(theta) * Math.cos(phi) + Ftheta * Math.cos(theta) * Math.cos(phi) - Fphi * Math.sin(phi);
                        vVal = Fr * Math.sin(theta) * Math.sin(phi) + Ftheta * Math.cos(theta) * Math.sin(phi) + Fphi * Math.cos(phi);
                        wVal = Fr * Math.cos(theta) - Ftheta * Math.sin(theta);
                    } else {
                        const scope = mergeEvalScope(opts, { x, y, z });
                        uVal = toReal(xCompiled.evaluate(scope));
                        vVal = toReal(yCompiled.evaluate(scope));
                        wVal = toReal(zCompiled.evaluate(scope));
                    }

                    if (!isNaN(uVal) && isFinite(uVal) && !isNaN(vVal) && isFinite(vVal) && !isNaN(wVal) && isFinite(wVal)) {
                        const mag = Math.sqrt(uVal * uVal + vVal * vVal + wVal * wVal);
                        if (mag > ZERO_TOLERANCE) {
                            maxMag = Math.max(maxMag, mag);
                            points.push({ x, y, z, u: uVal, v: vVal, w: wVal, mag });
                        }
                    }
                } catch (err) { }
            }
        }
    }

    if (points.length === 0 || maxMag <= ZERO_TOLERANCE) {
        return null;
    }

    const minSpacing = Math.min(
        Math.abs(xStep) || Infinity,
        Math.abs(yStep) || Infinity,
        Math.abs(zStep) || Infinity
    );
    const safeSpacing = Number.isFinite(minSpacing) && minSpacing > ZERO_TOLERANCE ? minSpacing : 1;
    const scale = (safeSpacing * 0.75) / maxMag;

    return {
        x: points.map((point) => point.x),
        y: points.map((point) => point.y),
        z: points.map((point) => point.z),
        u: points.map((point) => point.u * scale),
        v: points.map((point) => point.v * scale),
        w: points.map((point) => point.w * scale)
    };
}

function sampleFluxLines3d(components, opts, coordSystem = 'cartesian') {
    const [xExpr, yExpr, zExpr] = components;
    const xCompiled = math.compile(preprocessExpr(xExpr));
    const yCompiled = math.compile(preprocessExpr(yExpr));
    const zCompiled = math.compile(preprocessExpr(zExpr));

    const [origXMin, origXMax] = opts.xDomain;
    const [origYMin, origYMax] = opts.yDomain;
    const [origZMin, origZMax] = opts.zDomain;
    const xMin = origXMin;
    const yMin = origYMin;
    const zMin = origZMin;
    const xMax = opts.tracingVar === 'x' && opts.tracingLimit !== undefined ? Math.min(origXMax, opts.tracingLimit) : origXMax;
    const yMax = opts.tracingVar === 'y' && opts.tracingLimit !== undefined ? Math.min(origYMax, opts.tracingLimit) : origYMax;
    const zMax = opts.tracingVar === 'z' && opts.tracingLimit !== undefined ? Math.min(origZMax, opts.tracingLimit) : origZMax;

    if (xMax <= xMin || yMax <= yMin || zMax <= zMin) {
        return null;
    }

    const evalVectorField = (x, y, z) => {
        if (shouldSkipCartesianPoint(opts, x, y, z)) {
            return null;
        }

        try {
            let uVal, vVal, wVal;
            if (coordSystem === 'cylindrical') {
                const r = Math.sqrt(x*x + y*y);
                const theta = Math.atan2(y, x);
                const scope = mergeEvalScope(opts, { r, theta, z });
                const Fr = toReal(xCompiled.evaluate(scope));
                const Ftheta = toReal(yCompiled.evaluate(scope));
                const Fz = toReal(zCompiled.evaluate(scope));
                
                uVal = Fr * Math.cos(theta) - Ftheta * Math.sin(theta);
                vVal = Fr * Math.sin(theta) + Ftheta * Math.cos(theta);
                wVal = Fz;
            } else if (coordSystem === 'spherical') {
                const r = Math.sqrt(x*x + y*y + z*z);
                const theta = r > ZERO_TOLERANCE ? Math.acos(z / r) : 0;
                const phi = Math.atan2(y, x);
                const scope = mergeEvalScope(opts, { r, theta, phi });
                const Fr = toReal(xCompiled.evaluate(scope));
                const Ftheta = toReal(yCompiled.evaluate(scope));
                const Fphi = toReal(zCompiled.evaluate(scope));
                
                uVal = Fr * Math.sin(theta) * Math.cos(phi) + Ftheta * Math.cos(theta) * Math.cos(phi) - Fphi * Math.sin(phi);
                vVal = Fr * Math.sin(theta) * Math.sin(phi) + Ftheta * Math.cos(theta) * Math.sin(phi) + Fphi * Math.cos(phi);
                wVal = Fr * Math.cos(theta) - Ftheta * Math.sin(theta);
            } else {
                const scope = mergeEvalScope(opts, { x, y, z });
                uVal = toReal(xCompiled.evaluate(scope));
                vVal = toReal(yCompiled.evaluate(scope));
                wVal = toReal(zCompiled.evaluate(scope));
            }

            if (isNaN(uVal) || !isFinite(uVal) || isNaN(vVal) || !isFinite(vVal) || isNaN(wVal) || !isFinite(wVal)) {
                return null;
            }
            const mag = Math.sqrt(uVal * uVal + vVal * vVal + wVal * wVal);
            return { u: uVal, v: vVal, w: wVal, mag };
        } catch (err) {
            return null;
        }
    };

    // Generate 180 random seed points uniformly distributed in the domain
    const seeds = [];
    const numSeeds = 180;
    for (let i = 0; i < numSeeds; i++) {
        seeds.push({
            x: xMin + Math.random() * (xMax - xMin),
            y: yMin + Math.random() * (yMax - yMin),
            z: zMin + Math.random() * (zMax - zMin)
        });
    }

    const linesX = [];
    const linesY = [];
    const linesZ = [];
    const colors = [];

    const coneX = [];
    const coneY = [];
    const coneZ = [];
    const coneU = [];
    const coneV = [];
    const coneW = [];
    const coneMags = [];

    // Calculate dynamic step size based on domain diagonal size
    const diag = Math.sqrt((xMax - xMin) ** 2 + (yMax - yMin) ** 2 + (zMax - zMin) ** 2);
    const h = 0.015 * diag;
    const maxSteps = 80;

    // Small boundary margin of 10% to let lines exit nicely
    const xMargin = (xMax - xMin) * 0.1;
    const yMargin = (yMax - yMin) * 0.1;
    const zMargin = (zMax - zMin) * 0.1;

    const xBoundMin = xMin - xMargin;
    const xBoundMax = xMax + xMargin;
    const yBoundMin = yMin - yMargin;
    const yBoundMax = yMax + yMargin;
    const zBoundMin = zMin - zMargin;
    const zBoundMax = zMax + zMargin;

    let globalMaxMag = 0;

    for (const seed of seeds) {
        // Trace forward (dir = 1) and backward (dir = -1) from the seed
        for (const dir of [1, -1]) {
            let p = { ...seed };
            const pathX = [p.x];
            const pathY = [p.y];
            const pathZ = [p.z];
            const pathMags = [];

            const initVal = evalVectorField(p.x, p.y, p.z);
            if (!initVal || initVal.mag <= ZERO_TOLERANCE) continue;
            pathMags.push(initVal.mag);
            globalMaxMag = Math.max(globalMaxMag, initVal.mag);

            for (let step = 0; step < maxSteps; step++) {
                const current = evalVectorField(p.x, p.y, p.z);
                if (!current || current.mag <= ZERO_TOLERANCE) break;

                // RK4 integration
                const u_norm = current.u / current.mag;
                const v_norm = current.v / current.mag;
                const w_norm = current.w / current.mag;

                const k1x = u_norm;
                const k1y = v_norm;
                const k1z = w_norm;

                const p2 = {
                    x: p.x + dir * (h / 2) * k1x,
                    y: p.y + dir * (h / 2) * k1y,
                    z: p.z + dir * (h / 2) * k1z
                };
                const val2 = evalVectorField(p2.x, p2.y, p2.z);
                if (!val2 || val2.mag <= ZERO_TOLERANCE) break;
                const k2x = val2.u / val2.mag;
                const k2y = val2.v / val2.mag;
                const k2z = val2.w / val2.mag;

                const p3 = {
                    x: p.x + dir * (h / 2) * k2x,
                    y: p.y + dir * (h / 2) * k2y,
                    z: p.z + dir * (h / 2) * k2z
                };
                const val3 = evalVectorField(p3.x, p3.y, p3.z);
                if (!val3 || val3.mag <= ZERO_TOLERANCE) break;
                const k3x = val3.u / val3.mag;
                const k3y = val3.v / val3.mag;
                const k3z = val3.w / val3.mag;

                const p4 = {
                    x: p.x + dir * h * k3x,
                    y: p.y + dir * h * k3y,
                    z: p.z + dir * h * k3z
                };
                const val4 = evalVectorField(p4.x, p4.y, p4.z);
                if (!val4 || val4.mag <= ZERO_TOLERANCE) break;
                const k4x = val4.u / val4.mag;
                const k4y = val4.v / val4.mag;
                const k4z = val4.w / val4.mag;

                p.x += dir * (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
                p.y += dir * (h / 6) * (k1y + 2 * k2y + 2 * k3y + k4y);
                p.z += dir * (h / 6) * (k1z + 2 * k2z + 2 * k3z + k4z);

                if (p.x < xBoundMin || p.x > xBoundMax ||
                    p.y < yBoundMin || p.y > yBoundMax ||
                    p.z < zBoundMin || p.z > zBoundMax) {
                    break;
                }

                // Check if we are trapped or oscillating (new point is very close to point from 2 steps ago)
                if (pathX.length >= 2) {
                    const prev2X = pathX[pathX.length - 2];
                    const prev2Y = pathY[pathY.length - 2];
                    const prev2Z = pathZ[pathZ.length - 2];
                    const distSq = (p.x - prev2X) ** 2 + (p.y - prev2Y) ** 2 + (p.z - prev2Z) ** 2;
                    if (distSq < (h * 0.5) ** 2) {
                        break;
                    }
                }

                pathX.push(p.x);
                pathY.push(p.y);
                pathZ.push(p.z);
                pathMags.push(current.mag);
                globalMaxMag = Math.max(globalMaxMag, current.mag);
            }

            if (pathX.length > 1) {
                if (dir === -1) {
                    pathX.reverse();
                    pathY.reverse();
                    pathZ.reverse();
                    pathMags.reverse();
                }

                linesX.push(...pathX, null);
                linesY.push(...pathY, null);
                linesZ.push(...pathZ, null);
                colors.push(...pathMags, null);

                // Add an arrowhead cone in the middle of each streamline (if reasonably long)
                if (pathX.length > 6) {
                    const midIdx = Math.floor(pathX.length / 2);
                    const px = pathX[midIdx];
                    const py = pathY[midIdx];
                    const pz = pathZ[midIdx];

                    const val = evalVectorField(px, py, pz);
                    if (val && val.mag > ZERO_TOLERANCE) {
                        coneX.push(px);
                        coneY.push(py);
                        coneZ.push(pz);
                        coneU.push(val.u / val.mag);
                        coneV.push(val.v / val.mag);
                        coneW.push(val.w / val.mag);
                        coneMags.push(val.mag);
                    }
                }
            }
        }
    }

    if (linesX.length === 0) {
        return null;
    }

    const normColors = colors.map(val => {
        if (val === null) return null;
        return globalMaxMag > ZERO_TOLERANCE ? val / globalMaxMag : 0;
    });

    const scaledConeU = [];
    const scaledConeV = [];
    const scaledConeW = [];
    for (let i = 0; i < coneX.length; i++) {
        const factor = globalMaxMag > ZERO_TOLERANCE ? coneMags[i] / globalMaxMag : 0;
        scaledConeU.push(coneU[i] * factor);
        scaledConeV.push(coneV[i] * factor);
        scaledConeW.push(coneW[i] * factor);
    }

    return {
        x: linesX,
        y: linesY,
        z: linesZ,
        color: normColors,
        coneX,
        coneY,
        coneZ,
        coneU: scaledConeU,
        coneV: scaledConeV,
        coneW: scaledConeW
    };
}

function nodeContainsSymbol(node, symbolName) {
    let found = false;
    node.traverse((child) => {
        if (child && child.isSymbolNode && child.name === symbolName) {
            found = true;
        }
    });
    return found;
}

function isZeroNode(node) {
    const simplified = math.simplify(node);
    if (simplified.toString() === '0') {
        return true;
    }

    if (nodeContainsSymbol(simplified, 'x') || nodeContainsSymbol(simplified, 'y') || nodeContainsSymbol(simplified, 'z')) {
        return false;
    }

    try {
        const value = toReal(simplified.compile().evaluate({ x: 1, y: 1, z: 1 }));
        return !isNaN(value) && isFinite(value) && Math.abs(value) < ZERO_TOLERANCE;
    } catch (err) {
        return false;
    }
}

function substituteSymbolWithZero(node, symbolName) {
    return node.transform((child) => {
        if (child && child.isSymbolNode && child.name === symbolName) {
            return math.parse('0');
        }
        return child;
    });
}

function buildExplicitSurfaceFromLinearZ(combinedExpr, opts) {
    const combinedNode = math.parse(combinedExpr);
    const zCoeffNode = math.simplify(math.derivative(combinedNode, 'z'));

    if (isZeroNode(zCoeffNode)) {
        return null;
    }

    const zSecondDerivative = math.simplify(math.derivative(zCoeffNode, 'z'));
    if (!isZeroNode(zSecondDerivative)) {
        return null;
    }

    const zFreeNode = math.simplify(substituteSymbolWithZero(combinedNode, 'z'));
    const zCoeffCompiled = zCoeffNode.compile();
    const zFreeCompiled = zFreeNode.compile();

    const xMin = opts.xDomain[0];
    const xMax = opts.xDomain[1];
    const yMin = opts.yDomain[0];
    const yMax = opts.yDomain[1];
    const gridSteps = 40;
    const xGrid = [];
    const yGrid = [];

    for (let i = 0; i <= gridSteps; i++) {
        xGrid.push(xMin + i * (xMax - xMin) / gridSteps);
    }
    for (let j = 0; j <= gridSteps; j++) {
        yGrid.push(yMin + j * (yMax - yMin) / gridSteps);
    }

    const zGrid = [];
    const allZ = [];

    for (let j = 0; j <= gridSteps; j++) {
        const row = [];
        const y = yGrid[j];
        for (let i = 0; i <= gridSteps; i++) {
            const x = xGrid[i];
            if (isTracingLimited(opts, 'x', x) || isTracingLimited(opts, 'y', y)) {
                row.push(null);
                continue;
            }

            try {
                const scope = mergeEvalScope(opts, { x, y });
                const zCoeff = toReal(zCoeffCompiled.evaluate(scope));
                const zFree = toReal(zFreeCompiled.evaluate(scope));

                if (!isNaN(zCoeff) && isFinite(zCoeff) && Math.abs(zCoeff) > ZERO_TOLERANCE && !isNaN(zFree) && isFinite(zFree)) {
                    const zValue = -zFree / zCoeff;
                    if (!isNaN(zValue) && isFinite(zValue) && !isTracingLimited(opts, 'z', zValue)) {
                        row.push(zValue);
                        allZ.push(zValue);
                        continue;
                    }
                }
            } catch (err) { }

            row.push(null);
        }
        zGrid.push(row);
    }

    if (allZ.length === 0) {
        return null;
    }

    if (!opts.zDomain) {
        const zMin = Math.min(...allZ);
        const zMax = Math.max(...allZ);
        const margin = (zMax - zMin) * 0.1 || 0.5;
        opts.zDomain = [zMin - margin, zMax + margin];
    }

    let latexText = '';
    try {
        const explicitNode = math.simplify(`-(${zFreeNode.toString()}) / (${zCoeffNode.toString()})`);
        latexText = `z = ${explicitNode.toTex()}`;
    } catch (err) { }

    return {
        type: 'surface',
        plotData: { x: xGrid, y: yGrid, z: zGrid },
        latexText
    };
}

function buildTempVideoPath() {
    const suffix = `${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    return path.join(os.tmpdir(), `plot3d_rotation_${suffix}.mp4`);
}

// Compile in-memory JPEG frames into an H.264 MP4 using ffmpeg.
function compileVideo(frameBuffers, fps = DEFAULT_ANIMATION_FPS) {
    return new Promise((resolve, reject) => {
        const outputPath = buildTempVideoPath();
        const ffmpeg = spawn('ffmpeg', [
            '-y',
            '-loglevel', 'error',
            '-f', 'image2pipe',
            '-framerate', String(fps),
            '-vcodec', 'mjpeg',
            '-i', 'pipe:0',
            '-an',
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
            outputPath
        ]);

        let stderr = '';
        let settled = false;

        const cleanupOutput = () => {
            if (fs.existsSync(outputPath)) {
                try {
                    fs.unlinkSync(outputPath);
                } catch (err) { }
            }
        };

        const fail = (err) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanupOutput();
            reject(err);
        };

        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        ffmpeg.on('error', fail);
        ffmpeg.stdin.on('error', (err) => {
            if (err.code !== 'EPIPE') {
                fail(err);
            }
        });

        ffmpeg.on('close', (code) => {
            if (settled) {
                return;
            }

            if (code !== 0) {
                fail(new Error(`ffmpeg exited with code ${code}. Stderr: ${stderr || 'No stderr output.'}`));
                return;
            }

            try {
                const videoBuf = fs.readFileSync(outputPath);
                cleanupOutput();
                settled = true;
                resolve(videoBuf);
            } catch (err) {
                fail(err);
            }
        });

        for (const frameBuffer of frameBuffers) {
            ffmpeg.stdin.write(frameBuffer);
        }
        ffmpeg.stdin.end();
    });
}

function buildPlot3dScene(context, opts) {
    const {
        customOptions,
        expr,
        namedVectorField,
        bareTuple,
        coordSystem,
        isVectorField,
        isParametricSurface,
        isExplicitPolarSurface,
        isParametricCurve,
        isImplicitEquation,
        lhsVal,
        rhsVal,
        parameterDomain1,
        parameterDomain2,
        providedDomains
    } = context;

    const getBounds = (arr, fallback) => {
        if (arr.length === 0) return fallback;
        const min = Math.min(...arr);
        const max = Math.max(...arr);
        const margin = (max - min) * 0.1 || 0.5;
        return [min - margin, max + margin];
    };

    let type = '';
    let plotData = null;
    let latexText = '';

    if (customOptions.pdeData) {
        return {
            success: true,
            type: 'surface',
            plotData: customOptions.pdeData,
            latexText: customOptions.latexText || ''
        };
    }

    if (isVectorField) {
        const isFlux = customOptions.isFlux || false;
        type = isFlux ? 'flux3d' : 'vector3d';
        const fieldName = namedVectorField ? namedVectorField.name : 'F';
        const components = namedVectorField ? namedVectorField.components : bareTuple;

        if (!opts.zDomain) {
            opts.zDomain = [...opts.xDomain];
        }

        plotData = isFlux ? sampleFluxLines3d(components, opts, coordSystem) : sampleVectorField3d(components, opts, coordSystem);
        if (!plotData) {
            return {
                success: false,
                error: isFlux
                    ? 'No valid flux lines could be computed. Check if the field is defined on the given domains.'
                    : 'No valid real vectors were computed for this field. Check if the field is defined on the given domains.'
            };
        }

        try {
            const [uExpr, vExpr, wExpr] = components;
            const texU = math.parse(uExpr).toTex();
            const texV = math.parse(vExpr).toTex();
            const texW = math.parse(wExpr).toTex();
            if (coordSystem === 'cylindrical') {
                latexText = `\\vec{${fieldName}}(r,\\theta,z) = \\begin{pmatrix} ${texU} \\\\ ${texV} \\\\ ${texW} \\end{pmatrix}`;
            } else if (coordSystem === 'spherical') {
                latexText = `\\vec{${fieldName}}(r,\\theta,\\phi) = \\begin{pmatrix} ${texU} \\\\ ${texV} \\\\ ${texW} \\end{pmatrix}`;
            } else {
                latexText = `\\vec{${fieldName}}(x,y,z) = \\begin{pmatrix} ${texU} \\\\ ${texV} \\\\ ${texW} \\end{pmatrix}`;
            }
        } catch (e) {
            latexText = `\\vec{${fieldName}} = \\left( ${components.join(', ')} \\right)`;
        }

        return { success: true, type, plotData, latexText };
    }

    if (isParametricSurface) {
        type = 'surface';
        const [xExpr, yExpr, zExpr] = bareTuple.map((value) => value.trim());
        const xCompiled = math.compile(preprocessExpr(xExpr));
        const yCompiled = math.compile(preprocessExpr(yExpr));
        const zCompiled = math.compile(preprocessExpr(zExpr));

        const [uMin, uMax] = parameterDomain1;
        const [vMin, vMax] = parameterDomain2;
        const gridSteps = 40;
        const uStep = (uMax - uMin) / gridSteps;
        const vStep = (vMax - vMin) / gridSteps;

        const xGrid = [];
        const yGrid = [];
        const zGrid = [];

        for (let j = 0; j <= gridSteps; j++) {
            const v = vMin + j * vStep;
            const rowX = [];
            const rowY = [];
            const rowZ = [];
            for (let i = 0; i <= gridSteps; i++) {
                const u = uMin + i * uStep;
                if (isTracingLimited(opts, 'u', u) || isTracingLimited(opts, 'v', v)) {
                    rowX.push(null);
                    rowY.push(null);
                    rowZ.push(null);
                    continue;
                }

                try {
                    const scope = mergeEvalScope(opts, { u, v });
                    const xVal = toReal(xCompiled.evaluate(scope));
                    const yVal = toReal(yCompiled.evaluate(scope));
                    const zVal = toReal(zCompiled.evaluate(scope));
                    if (!isNaN(xVal) && isFinite(xVal) && !isNaN(yVal) && isFinite(yVal) && !isNaN(zVal) && isFinite(zVal)) {
                        rowX.push(xVal);
                        rowY.push(yVal);
                        rowZ.push(zVal);
                    } else {
                        rowX.push(null);
                        rowY.push(null);
                        rowZ.push(null);
                    }
                } catch (e) {
                    rowX.push(null);
                    rowY.push(null);
                    rowZ.push(null);
                }
            }
            xGrid.push(rowX);
            yGrid.push(rowY);
            zGrid.push(rowZ);
        }

        plotData = { x: xGrid, y: yGrid, z: zGrid };
        const flatX = xGrid.flat().filter((value) => value !== null);
        const flatY = yGrid.flat().filter((value) => value !== null);
        const flatZ = zGrid.flat().filter((value) => value !== null);

        if (flatX.length === 0) {
            return { success: false, error: 'No valid real numbers were computed for this surface.' };
        }

        if (!providedDomains.x) opts.xDomain = getBounds(flatX, [-5, 5]);
        if (!providedDomains.y) opts.yDomain = getBounds(flatY, [-5, 5]);
        if (!providedDomains.z && !opts.zDomain) opts.zDomain = getBounds(flatZ, [-5, 5]);

        try {
            const texX = math.parse(xExpr).toTex();
            const texY = math.parse(yExpr).toTex();
            const texZ = math.parse(zExpr).toTex();
            latexText = `\\vec{r}(u,v) = \\begin{pmatrix} ${texX} \\\\ ${texY} \\\\ ${texZ} \\end{pmatrix}`;
        } catch (e) {
            latexText = `\\vec{r}(u,v) = \\left( ${xExpr},\\ ${yExpr},\\ ${zExpr} \\right)`;
        }

        return { success: true, type, plotData, latexText };
    }

    if (isExplicitPolarSurface) {
        type = 'surface';
        const rCompiled = math.compile(preprocessExpr(rhsVal));
        const [uMin, uMax] = parameterDomain1;
        const [vMin, vMax] = parameterDomain2;
        const gridSteps = 40;
        const uStep = (uMax - uMin) / gridSteps;
        const vStep = (vMax - vMin) / gridSteps;

        const xGrid = [];
        const yGrid = [];
        const zGrid = [];

        for (let j = 0; j <= gridSteps; j++) {
            const v = vMin + j * vStep;
            const rowX = [];
            const rowY = [];
            const rowZ = [];
            for (let i = 0; i <= gridSteps; i++) {
                const u = uMin + i * uStep;
                const shouldTraceSkip = coordSystem === 'spherical'
                    ? isTracingLimited(opts, 'theta', u) || isTracingLimited(opts, 'phi', v)
                    : isTracingLimited(opts, 'theta', u) || isTracingLimited(opts, 'z', v);
                if (shouldTraceSkip) {
                    rowX.push(null);
                    rowY.push(null);
                    rowZ.push(null);
                    continue;
                }

                try {
                    let rVal;
                    let xVal;
                    let yVal;
                    let zVal;

                    if (coordSystem === 'spherical') {
                        const scope = mergeEvalScope(opts, { theta: u, phi: v });
                        rVal = toReal(rCompiled.evaluate(scope));
                        if (!isNaN(rVal) && isFinite(rVal)) {
                            xVal = rVal * Math.sin(u) * Math.cos(v);
                            yVal = rVal * Math.sin(u) * Math.sin(v);
                            zVal = rVal * Math.cos(u);
                        }
                    } else {
                        const scope = mergeEvalScope(opts, { theta: u, z: v });
                        rVal = toReal(rCompiled.evaluate(scope));
                        if (!isNaN(rVal) && isFinite(rVal)) {
                            xVal = rVal * Math.cos(u);
                            yVal = rVal * Math.sin(u);
                            zVal = v;
                        }
                    }

                    if (rVal !== undefined && !isNaN(rVal) && isFinite(rVal)) {
                        rowX.push(xVal);
                        rowY.push(yVal);
                        rowZ.push(zVal);
                    } else {
                        rowX.push(null);
                        rowY.push(null);
                        rowZ.push(null);
                    }
                } catch (e) {
                    rowX.push(null);
                    rowY.push(null);
                    rowZ.push(null);
                }
            }
            xGrid.push(rowX);
            yGrid.push(rowY);
            zGrid.push(rowZ);
        }

        plotData = { x: xGrid, y: yGrid, z: zGrid };
        const flatX = xGrid.flat().filter((value) => value !== null);
        const flatY = yGrid.flat().filter((value) => value !== null);
        const flatZ = zGrid.flat().filter((value) => value !== null);

        if (flatX.length === 0) {
            return { success: false, error: 'No valid real numbers were computed for this surface.' };
        }

        if (!providedDomains.x) opts.xDomain = getBounds(flatX, [-5, 5]);
        if (!providedDomains.y) opts.yDomain = getBounds(flatY, [-5, 5]);
        if (!providedDomains.z && !opts.zDomain) opts.zDomain = getBounds(flatZ, [-5, 5]);

        try {
            const texR = math.parse(rhsVal).toTex();
            latexText = `r = ${texR}`;
        } catch (e) {
            latexText = `r = ${rhsVal}`;
        }

        return { success: true, type, plotData, latexText };
    }

    if (isParametricCurve) {
        type = 'curve';
        const [xExpr, yExpr, zExpr] = bareTuple.map((value) => value.trim());
        const xCompiled = math.compile(preprocessExpr(xExpr));
        const yCompiled = math.compile(preprocessExpr(yExpr));
        const zCompiled = math.compile(preprocessExpr(zExpr));

        const [tMin, tMax] = parameterDomain1 || [0, 2 * Math.PI];
        const steps = 250;
        const tStep = (tMax - tMin) / steps;
        const limitT = (opts.tracingVar === 't' && opts.tracingLimit !== undefined) ? Math.min(opts.tracingLimit, tMax) : tMax;

        const xVals = [];
        const yVals = [];
        const zVals = [];

        for (let i = 0; i <= steps; i++) {
            const t = tMin + i * tStep;
            if (t > limitT) break;

            try {
                const scope = mergeEvalScope(opts, { t });
                const x = toReal(xCompiled.evaluate(scope));
                const y = toReal(yCompiled.evaluate(scope));
                const z = toReal(zCompiled.evaluate(scope));

                if (!isNaN(x) && isFinite(x) && !isNaN(y) && isFinite(y) && !isNaN(z) && isFinite(z)) {
                    xVals.push(x);
                    yVals.push(y);
                    zVals.push(z);
                }
            } catch (err) { }
        }

        plotData = { x: xVals, y: yVals, z: zVals };

        if (xVals.length === 0) {
            return {
                success: false,
                error: 'No valid real numbers were computed for this curve. Check if the function is defined on the given domain.'
            };
        }

        if (!providedDomains.x) opts.xDomain = getBounds(xVals, [-5, 5]);
        if (!providedDomains.y) opts.yDomain = getBounds(yVals, [-5, 5]);
        if (!providedDomains.z && !opts.zDomain) opts.zDomain = getBounds(zVals, [-5, 5]);

        try {
            const texX = math.parse(xExpr).toTex();
            const texY = math.parse(yExpr).toTex();
            const texZ = math.parse(zExpr).toTex();
            latexText = `\\vec{r}(t) = \\begin{pmatrix} ${texX} \\\\ ${texY} \\\\ ${texZ} \\end{pmatrix}`;
        } catch (e) {
            latexText = `\\vec{r}(t) = \\left( ${xExpr}, ${yExpr}, ${zExpr} \\right)`;
        }

        return { success: true, type, plotData, latexText };
    }

    let lhs = lhsVal;
    let rhs = rhsVal;
    if (!expr.includes('=')) {
        lhs = 'z';
        rhs = expr;
    }

    if (isImplicitEquation) {
        const combined = `(${preprocessExpr(lhs)}) - (${preprocessExpr(rhs)})`;
        const projectedSurface = buildExplicitSurfaceFromLinearZ(combined, opts);

        if (projectedSurface) {
            try {
                latexText = projectedSurface.latexText || `${math.parse(lhs).toTex()} = ${math.parse(rhs).toTex()}`;
            } catch (e) {
                latexText = projectedSurface.latexText || `${lhs} = ${rhs}`;
            }
            return {
                success: true,
                type: projectedSurface.type,
                plotData: projectedSurface.plotData,
                latexText
            };
        }

        type = 'implicit';
        const compiled = math.compile(combined);
        const xMin = opts.xDomain[0];
        const xMax = opts.xDomain[1];
        const yMin = opts.yDomain[0];
        const yMax = opts.yDomain[1];

        const zMin = (opts.zDomain && opts.zDomain[0] !== undefined) ? opts.zDomain[0] : xMin;
        const zMax = (opts.zDomain && opts.zDomain[1] !== undefined) ? opts.zDomain[1] : xMax;
        opts.zDomain = [zMin, zMax];

        const coarseSteps = 30;
        const coarseV = [];
        for (let i = 0; i <= coarseSteps; i++) {
            const x = xMin + i * (xMax - xMin) / coarseSteps;
            const row = [];
            for (let j = 0; j <= coarseSteps; j++) {
                const y = yMin + j * (yMax - yMin) / coarseSteps;
                const col = [];
                for (let k = 0; k <= coarseSteps; k++) {
                    const z = zMin + k * (zMax - zMin) / coarseSteps;
                    if (shouldSkipCartesianPoint(opts, x, y, z)) {
                        col.push(NaN);
                        continue;
                    }

                    let val = NaN;
                    try {
                        if (coordSystem === 'spherical') {
                            const r = Math.sqrt(x*x + y*y + z*z);
                            const theta = r > ZERO_TOLERANCE ? Math.acos(z / r) : 0;
                            const phi = Math.atan2(y, x);
                            val = toReal(compiled.evaluate(mergeEvalScope(opts, { x, y, z, r, theta, phi })));
                        } else if (coordSystem === 'cylindrical') {
                            const r = Math.sqrt(x*x + y*y);
                            const theta = Math.atan2(y, x);
                            val = toReal(compiled.evaluate(mergeEvalScope(opts, { x, y, z, r, theta })));
                        } else {
                            val = toReal(compiled.evaluate(mergeEvalScope(opts, { x, y, z })));
                        }
                    } catch (e) { }
                    col.push(!isNaN(val) && isFinite(val) ? val : NaN);
                }
                row.push(col);
            }
            coarseV.push(row);
        }

        const activeX = [];
        const activeY = [];
        const activeZ = [];

        for (let i = 0; i <= coarseSteps; i++) {
            const x = xMin + i * (xMax - xMin) / coarseSteps;
            for (let j = 0; j <= coarseSteps; j++) {
                const y = yMin + j * (yMax - yMin) / coarseSteps;
                for (let k = 0; k <= coarseSteps; k++) {
                    const z = zMin + k * (zMax - zMin) / coarseSteps;
                    const val = coarseV[i][j][k];
                    if (isNaN(val)) continue;

                    let hasCrossing = false;
                    const neighbors = [
                        [i + 1, j, k],
                        [i, j + 1, k],
                        [i, j, k + 1],
                        [i - 1, j, k],
                        [i, j - 1, k],
                        [i, j, k - 1]
                    ];

                    for (const [ni, nj, nk] of neighbors) {
                        if (ni >= 0 && ni <= coarseSteps &&
                            nj >= 0 && nj <= coarseSteps &&
                            nk >= 0 && nk <= coarseSteps) {
                            const nVal = coarseV[ni][nj][nk];
                            if (!isNaN(nVal) && val * nVal <= 0) {
                                hasCrossing = true;
                                break;
                            }
                        }
                    }

                    if (hasCrossing) {
                        activeX.push(x);
                        activeY.push(y);
                        activeZ.push(z);
                    }
                }
            }
        }

        let evalXMin = xMin;
        let evalXMax = xMax;
        let evalYMin = yMin;
        let evalYMax = yMax;
        let evalZMin = zMin;
        let evalZMax = zMax;

        if (activeX.length > 0) {
            const rawMinX = Math.min(...activeX);
            const rawMaxX = Math.max(...activeX);
            const rawMinY = Math.min(...activeY);
            const rawMaxY = Math.max(...activeY);
            const rawMinZ = Math.min(...activeZ);
            const rawMaxZ = Math.max(...activeZ);

            const padX = (rawMaxX - rawMinX) * 0.15 || 0.2;
            const padY = (rawMaxY - rawMinY) * 0.15 || 0.2;
            const padZ = (rawMaxZ - rawMinZ) * 0.15 || 0.2;

            evalXMin = Math.max(xMin, rawMinX - padX);
            evalXMax = Math.min(xMax, rawMaxX + padX);
            evalYMin = Math.max(yMin, rawMinY - padY);
            evalYMax = Math.min(yMax, rawMaxY + padY);
            evalZMin = Math.max(zMin, rawMinZ - padZ);
            evalZMax = Math.min(zMax, rawMaxZ + padZ);

            if (evalXMax - evalXMin < 0.5) {
                const cx = (evalXMin + evalXMax) / 2;
                evalXMin = Math.max(xMin, cx - 0.25);
                evalXMax = Math.min(xMax, cx + 0.25);
            }
            if (evalYMax - evalYMin < 0.5) {
                const cy = (evalYMin + evalYMax) / 2;
                evalYMin = Math.max(yMin, cy - 0.25);
                evalYMax = Math.min(yMax, cy + 0.25);
            }
            if (evalZMax - evalZMin < 0.5) {
                const cz = (evalZMin + evalZMax) / 2;
                evalZMin = Math.max(zMin, cz - 0.25);
                evalZMax = Math.min(zMax, cz + 0.25);
            }

            if (!providedDomains.x) opts.xDomain = [evalXMin, evalXMax];
            if (!providedDomains.y) opts.yDomain = [evalYMin, evalYMax];
            if (!providedDomains.z) opts.zDomain = [evalZMin, evalZMax];
        }

        const gridSteps = 35;
        const xVals = [];
        const yVals = [];
        const zVals = [];
        const valueVals = [];

        for (let i = 0; i <= gridSteps; i++) {
            const x = evalXMin + i * (evalXMax - evalXMin) / gridSteps;
            for (let j = 0; j <= gridSteps; j++) {
                const y = evalYMin + j * (evalYMax - evalYMin) / gridSteps;
                for (let k = 0; k <= gridSteps; k++) {
                    const z = evalZMin + k * (evalZMax - evalZMin) / gridSteps;
                    xVals.push(x);
                    yVals.push(y);
                    zVals.push(z);

                    if (shouldSkipCartesianPoint(opts, x, y, z)) {
                        valueVals.push(NaN);
                        continue;
                    }

                    try {
                        let val;
                        if (coordSystem === 'spherical') {
                            const r = Math.sqrt(x*x + y*y + z*z);
                            const theta = r > ZERO_TOLERANCE ? Math.acos(z / r) : 0;
                            const phi = Math.atan2(y, x);
                            val = toReal(compiled.evaluate(mergeEvalScope(opts, { x, y, z, r, theta, phi })));
                        } else if (coordSystem === 'cylindrical') {
                            const r = Math.sqrt(x*x + y*y);
                            const theta = Math.atan2(y, x);
                            val = toReal(compiled.evaluate(mergeEvalScope(opts, { x, y, z, r, theta })));
                        } else {
                            val = toReal(compiled.evaluate(mergeEvalScope(opts, { x, y, z })));
                        }
                        valueVals.push(!isNaN(val) && isFinite(val) ? val : NaN);
                    } catch (e) {
                        valueVals.push(NaN);
                    }
                }
            }
        }

        plotData = { x: xVals, y: yVals, z: zVals, value: valueVals };

        try {
            latexText = `${math.parse(lhs).toTex()} = ${math.parse(rhs).toTex()}`;
        } catch (e) {
            latexText = `${lhs} = ${rhs}`;
        }

        return { success: true, type, plotData, latexText };
    }

    type = 'surface';
    const compiled = math.compile(preprocessExpr(rhs));
    const xMin = opts.xDomain[0];
    const xMax = opts.xDomain[1];
    const yMin = opts.yDomain[0];
    const yMax = opts.yDomain[1];
    const gridSteps = 40;
    const xGrid = [];
    const yGrid = [];

    for (let i = 0; i <= gridSteps; i++) {
        xGrid.push(xMin + i * (xMax - xMin) / gridSteps);
    }
    for (let j = 0; j <= gridSteps; j++) {
        yGrid.push(yMin + j * (yMax - yMin) / gridSteps);
    }

    const zGrid = [];
    const allZ = [];

    for (let j = 0; j <= gridSteps; j++) {
        const row = [];
        const yValue = yGrid[j];
        for (let i = 0; i <= gridSteps; i++) {
            const xValue = xGrid[i];
            if (isTracingLimited(opts, 'x', xValue) || isTracingLimited(opts, 'y', yValue)) {
                row.push(null);
                continue;
            }

            try {
                let zValue;
                if (coordSystem === 'cylindrical') {
                    const r = Math.sqrt(xValue*xValue + yValue*yValue);
                    const theta = Math.atan2(yValue, xValue);
                    zValue = toReal(compiled.evaluate(mergeEvalScope(opts, { x: xValue, y: yValue, r, theta })));
                } else {
                    zValue = toReal(compiled.evaluate(mergeEvalScope(opts, { x: xValue, y: yValue })));
                }

                const ok = !isNaN(zValue) && isFinite(zValue) && !isTracingLimited(opts, 'z', zValue);
                row.push(ok ? zValue : null);
                if (ok) allZ.push(zValue);
            } catch (e) {
                row.push(null);
            }
        }
        zGrid.push(row);
    }

    plotData = { x: xGrid, y: yGrid, z: zGrid };

    if (allZ.length === 0) {
        return {
            success: false,
            error: 'No valid real numbers were computed for this surface. Check if the function is defined on the given domains.'
        };
    }

    if (!opts.zDomain) {
        const zMin = Math.min(...allZ);
        const zMax = Math.max(...allZ);
        const margin = (zMax - zMin) * 0.1 || 0.5;
        opts.zDomain = [zMin - margin, zMax + margin];
    }

    try {
        latexText = `z = ${math.parse(rhs).toTex()}`;
    } catch (e) {
        latexText = `z = ${rhs}`;
    }

    return { success: true, type, plotData, latexText };
}

async function renderPlot3d(rawExpr, customOptions = {}) {
    if (!katexModule.isInitialized()) {
        return { success: false, error: 'Local renderer is not initialized.' };
    }

    const releasePlot3dSlot = await acquirePlot3dSlot();
    let page = null;

    try {
        const expr = rawExpr.trim();
        const graphStyle = config.style.graph || {};
        const domains = customOptions.domains || [];
        const namedVectorField = parseNamedVectorField(expr);
        const bareTuple = namedVectorField ? null : parseVectorTuple(expr, 3);
        const coordSystem = getCoordinateSystem(expr, namedVectorField ? namedVectorField.components : bareTuple);
        const isBareVectorField = bareTuple && shouldTreatBareTupleAsVector(bareTuple, domains.length);
        const isVectorField = namedVectorField || isBareVectorField;
        const hasUV = bareTuple && bareTuple.some((component) => expressionUsesAnySymbol(component, ['u', 'v']));
        const isParametricSurface = bareTuple && hasUV && !isVectorField;
        const isParametricCurve = bareTuple && !hasUV && !isVectorField;

        let lhsVal = '';
        let rhsVal = '';
        let isExplicitPolarSurface = false;
        if (expr.includes('=')) {
            const eqIdx = expr.indexOf('=');
            lhsVal = expr.substring(0, eqIdx).trim();
            rhsVal = expr.substring(eqIdx + 1).trim();
            if (lhsVal.toLowerCase() === 'r') {
                isExplicitPolarSurface = true;
            }
        }

        const isImplicitEquation = !customOptions.pdeData &&
            !isVectorField &&
            !isParametricSurface &&
            !isParametricCurve &&
            !isExplicitPolarSurface &&
            expr.includes('=') &&
            lhsVal.toLowerCase() !== 'z';

        const evolutionRequested = Boolean(customOptions.isEvolutionAnimated);
        const cameraAnimationRequested = Boolean(customOptions.isCameraAnimated || (customOptions.isAnimated && !evolutionRequested));
        const traceVars = getPlot3dTraceVariables({
            isVectorField,
            isParametricSurface,
            isExplicitPolarSurface,
            isParametricCurve,
            coordSystem
        });

        let evolutionVar = evolutionRequested ? normalizeAnimationIdentifier(customOptions.evolutionVar) : null;
        if (evolutionRequested && !evolutionVar) {
            evolutionVar = getDefaultPlot3dEvolutionVar(expr, traceVars);
        }

        const isTracingMode = evolutionRequested && traceVars.includes(evolutionVar);
        const hasEvolutionSweep = evolutionRequested && !isTracingMode;
        const domainInfo = resolvePlot3dDomains({
            customOptions,
            domains,
            graphStyle,
            coordSystem,
            isVectorField,
            isParametricSurface,
            isExplicitPolarSurface,
            isParametricCurve,
            isImplicitEquation,
            hasEvolutionSweep
        });

        const baseOpts = {
            width: graphStyle.width || 600,
            height: graphStyle.height || 450,
            gridColor: graphStyle.gridColor || 'rgba(255, 255, 255, 0.08)',
            axisColor: graphStyle.axisColor || 'rgba(255, 255, 255, 0.3)',
            axisLabelColor: graphStyle.axisLabelColor || 'rgba(248, 250, 252, 0.8)',
            curveColors: graphStyle.curveColors || ['#06b6d4', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#84cc16'],
            lineWidth: graphStyle.lineWidth || 6,
            xDomain: domainInfo.xDomain,
            yDomain: domainInfo.yDomain,
            zDomain: domainInfo.zDomain,
            isAnimated: cameraAnimationRequested || evolutionRequested,
            isCameraAnimated: cameraAnimationRequested,
            isEvolutionAnimated: evolutionRequested,
            evolutionVar,
            tracingVar: isTracingMode ? evolutionVar : null,
            animationMode: customOptions.animationMode || 'swing',
            animationAxis: customOptions.animationAxis || 'z',
            animationAngle: customOptions.animationAngle || null,
            camera: buildDefaultCamera()
        };

        const plotContext = {
            customOptions,
            expr,
            namedVectorField,
            bareTuple,
            coordSystem,
            isVectorField,
            isParametricSurface,
            isExplicitPolarSurface,
            isParametricCurve,
            isImplicitEquation,
            lhsVal,
            rhsVal,
            parameterDomain1: domainInfo.parameterDomain1,
            parameterDomain2: domainInfo.parameterDomain2,
            providedDomains: domainInfo.providedDomains
        };

        page = await katexModule.createRenderPage();

        if (evolutionRequested) {
            const totalFrames = DEFAULT_ANIMATION_FRAMES;
            const frameBuffers = [];
            const traceBounds = isTracingMode
                ? resolvePlot3dTraceBounds(evolutionVar, domainInfo, coordSystem)
                : null;
            const evolutionDomain = hasEvolutionSweep ? domainInfo.evolutionDomain : null;

            for (let f = 0; f < totalFrames; f++) {
                const frameOpts = clonePlot3dOptions(baseOpts);
                const evolutionProgress = totalFrames === 1 ? 1 : (f + 1) / totalFrames;

                if (cameraAnimationRequested) {
                    const cameraProgress = frameOpts.animationMode === 'orbit'
                        ? f / totalFrames
                        : (totalFrames === 1 ? 0 : f / (totalFrames - 1));
                    frameOpts.camera = buildAnimationCamera(
                        cameraProgress,
                        frameOpts.animationMode,
                        frameOpts.animationAxis,
                        frameOpts.animationAngle
                    );
                }

                let evolutionValue = null;
                if (isTracingMode && traceBounds) {
                    frameOpts.tracingLimit = traceBounds[0] + evolutionProgress * (traceBounds[1] - traceBounds[0]);
                } else if (hasEvolutionSweep && evolutionDomain) {
                    evolutionValue = evolutionDomain[0] + evolutionProgress * (evolutionDomain[1] - evolutionDomain[0]);
                    frameOpts.evalScope = { [evolutionVar]: evolutionValue };
                }

                const scene = buildPlot3dScene(plotContext, frameOpts);
                if (!scene.success) {
                    return { success: false, error: scene.error };
                }

                const frameLatex = hasEvolutionSweep
                    ? appendEvolutionLatex(scene.latexText, evolutionVar, evolutionValue)
                    : scene.latexText;

                const renderResult = await page.evaluate((lat, t, pData, opt) => {
                    return window.renderGraph3d(lat, t, pData, opt);
                }, frameLatex, scene.type, scene.plotData, frameOpts);

                if (!renderResult.success) {
                    return { success: false, error: renderResult.error };
                }

                const card = await page.$('#card');
                if (!card) {
                    return { success: false, error: 'Card element not found in DOM.' };
                }

                const buf = await card.screenshot({ type: 'jpeg', quality: 85 });
                frameBuffers.push(buf);
            }

            try {
                const videoBuf = await compileVideo(frameBuffers, DEFAULT_ANIMATION_FPS);
                return {
                    success: true,
                    data: videoBuf.toString('base64'),
                    mimeType: 'video/mp4',
                    filename: 'plot3d.mp4',
                    source: 'local-plot3d-anim',
                    isAnimation: true
                };
            } catch (ffmpegErr) {
                console.warn('Failed to compile video with ffmpeg:', ffmpegErr.message);
                return {
                    success: true,
                    data: frameBuffers[0].toString('base64'),
                    mimeType: 'image/jpeg',
                    filename: 'plot3d_fallback.jpg',
                    source: 'local-plot3d-fallback'
                };
            }
        }

        const opts = clonePlot3dOptions(baseOpts);
        const scene = buildPlot3dScene(plotContext, opts);
        if (!scene.success) {
            return { success: false, error: scene.error };
        }

        const renderResult = await page.evaluate((lat, t, pData, opt) => {
            return window.renderGraph3d(lat, t, pData, opt);
        }, scene.latexText, scene.type, scene.plotData, opts);

        if (!renderResult.success) {
            return { success: false, error: renderResult.error };
        }

        const card = await page.$('#card');
        if (!card) {
            return { success: false, error: 'Card element not found in DOM.' };
        }

        if (cameraAnimationRequested) {
            const totalFrames = DEFAULT_ANIMATION_FRAMES;
            const frameBuffers = [];

            for (let f = 0; f < totalFrames; f++) {
                const progress = opts.animationMode === 'orbit'
                    ? f / totalFrames
                    : (totalFrames === 1 ? 0 : f / (totalFrames - 1));
                const camera = buildAnimationCamera(progress, opts.animationMode, opts.animationAxis, opts.animationAngle);

                await page.evaluate((nextCamera) => {
                    return Plotly.relayout('plotly-graph', { 'scene.camera': nextCamera }).then(() => {
                        return new Promise((resolve) => {
                            requestAnimationFrame(() => requestAnimationFrame(resolve));
                        });
                    });
                }, camera);

                const buf = await card.screenshot({ type: 'jpeg', quality: 85 });
                frameBuffers.push(buf);
            }

            try {
                const videoBuf = await compileVideo(frameBuffers, DEFAULT_ANIMATION_FPS);
                return {
                    success: true,
                    data: videoBuf.toString('base64'),
                    mimeType: 'video/mp4',
                    filename: 'plot3d.mp4',
                    source: 'local-plot3d-anim',
                    isAnimation: true
                };
            } catch (ffmpegErr) {
                console.warn('Failed to compile video with ffmpeg:', ffmpegErr.message);
                const fallbackBuf = frameBuffers[0] || await card.screenshot({ type: 'jpeg', quality: 85 });
                return {
                    success: true,
                    data: fallbackBuf.toString('base64'),
                    mimeType: 'image/jpeg',
                    filename: 'plot3d_fallback.jpg',
                    source: 'local-plot3d-fallback'
                };
            }
        }

        const buf = await card.screenshot({ type: 'png', omitBackground: true });
        return {
            success: true,
            data: buf.toString('base64'),
            mimeType: 'image/png',
            filename: 'plot3d.png',
            source: 'local-plot3d-static'
        };
    } catch (err) {
        console.error('Error during 3D plotting:', err);
        return { success: false, error: err.message };
    } finally {
        if (page) {
            try {
                await page.close();
            } catch (closeErr) { }
        }

        releasePlot3dSlot();
    }
}

module.exports = {
    renderPlot3d,
    compileVideo
};
