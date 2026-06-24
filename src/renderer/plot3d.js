const math = require('../math');
const config = require('../../config');
const katexModule = require('./katex');
const { splitByTopLevelCommas } = require('./plot');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { formatVarToTex } = require('../utils');
const { analyze3dPlot, expressionUsesAnySymbol } = require('../plot-semantics');
const ZERO_TOLERANCE = 1e-9;
const MAX_CONCURRENT_PLOT3D = Math.max(1, Number(config.bot?.plot3dMaxConcurrency) || 3);
const DEFAULT_ANIMATION_FRAMES = Math.max(6, Number(config.bot?.plot3dAnimationFrames) || 12);
const DEFAULT_ANIMATION_FPS = Math.max(4, Number(config.bot?.plot3dAnimationFps) || 10);
const DEFAULT_ANIMATION_BASE_ANGLE_DEGREES = Number(config.bot?.plot3dAnimationBaseAngleDegrees) || 45;
const DEFAULT_ANIMATION_SWING_DEGREES = Math.max(5, Math.min(44, Number(config.bot?.plot3dAnimationSwingDegrees) || 30));
const DEFAULT_ANIMATION_CAMERA_RADIUS = Math.max(0.8, Number(config.bot?.plot3dAnimationCameraRadius) || 1.6);
const DEFAULT_ANIMATION_CAMERA_HEIGHT = Math.max(0.4, Number(config.bot?.plot3dAnimationCameraHeight) || 1.1);
const DEFAULT_PLOT3D_CAMERA_CENTER_Z = Number(config.bot?.plot3dCameraCenterZ) || 0;
const DEFAULT_IMPLICIT_SURFACE_COARSE_STEPS = Math.max(12, Number(config.bot?.plot3dImplicitCoarseSteps) || 36);
const DEFAULT_IMPLICIT_SURFACE_GRID_STEPS = Math.max(
    DEFAULT_IMPLICIT_SURFACE_COARSE_STEPS + 4,
    Number(config.bot?.plot3dImplicitGridSteps) || 56
);
const DEFAULT_IMPLICIT_SURFACE_PADDING_RATIO = Math.max(0.05, Math.min(0.35, Number(config.bot?.plot3dImplicitPaddingRatio) || 0.15));

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
        center: { x: 0, y: 0, z: DEFAULT_PLOT3D_CAMERA_CENTER_Z }
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
        center: { x: 0, y: 0, z: DEFAULT_PLOT3D_CAMERA_CENTER_Z }
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
        center: { x: 0, y: 0, z: DEFAULT_PLOT3D_CAMERA_CENTER_Z }
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
    return Object.assign({}, localScope, opts.evalScope || {});
}

function cloneDomain(domain) {
    return Array.isArray(domain) ? [...domain] : domain;
}

function cloneVectorDomainMask(mask) {
    if (!mask || typeof mask !== 'object') {
        return mask;
    }

    return {
        cartesian: mask.cartesian ? {
            x: cloneDomain(mask.cartesian.x),
            y: cloneDomain(mask.cartesian.y),
            z: cloneDomain(mask.cartesian.z)
        } : null,
        cylindrical: mask.cylindrical ? {
            rho: cloneDomain(mask.cylindrical.rho),
            theta: cloneDomain(mask.cylindrical.theta),
            z: cloneDomain(mask.cylindrical.z)
        } : null,
        spherical: mask.spherical ? {
            radius: cloneDomain(mask.spherical.radius),
            theta: cloneDomain(mask.spherical.theta),
            phi: cloneDomain(mask.spherical.phi)
        } : null
    };
}

function clonePlot3dOptions(baseOpts) {
    return {
        ...baseOpts,
        xDomain: cloneDomain(baseOpts.xDomain),
        yDomain: cloneDomain(baseOpts.yDomain),
        zDomain: cloneDomain(baseOpts.zDomain),
        xLim: cloneDomain(baseOpts.xLim),
        yLim: cloneDomain(baseOpts.yLim),
        zLim: cloneDomain(baseOpts.zLim),
        camera: baseOpts.camera
            ? {
                eye: { ...baseOpts.camera.eye },
                up: { ...baseOpts.camera.up },
                center: { ...baseOpts.camera.center }
            }
            : buildDefaultCamera(),
        evalScope: baseOpts.evalScope ? { ...baseOpts.evalScope } : undefined,
        streamlineSeeds: baseOpts.streamlineSeeds
            ? baseOpts.streamlineSeeds.map((seed) => ({ ...seed }))
            : undefined,
        vectorDomainMask: cloneVectorDomainMask(baseOpts.vectorDomainMask)
    };
}

function buildAspectRatioFromDomains(xDomain, yDomain, zDomain) {
    const dx = Math.abs(xDomain[1] - xDomain[0]) || 1;
    const dy = Math.abs(yDomain[1] - yDomain[0]) || 1;
    const dz = Math.abs(zDomain[1] - zDomain[0]) || 1;
    const maxSpan = Math.max(dx, dy, dz);
    return {
        x: dx / maxSpan,
        y: dy / maxSpan,
        z: dz / maxSpan
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

function isValueWithinDomain(value, domain) {
    if (!Array.isArray(domain)) {
        return true;
    }

    return value >= domain[0] - 1e-5 && value <= domain[1] + 1e-5;
}

function isAngleWithinDomain(angle, domain) {
    if (!Array.isArray(domain)) {
        return true;
    }

    const [min, max] = domain;
    if (max - min >= 2 * Math.PI - 1e-5) {
        return true;
    }

    let normalized = angle;
    while (normalized < min) normalized += 2 * Math.PI;
    while (normalized >= min + 2 * Math.PI) normalized -= 2 * Math.PI;
    return normalized <= max + 1e-5;
}

function pointPassesVectorDomainMask(x, y, z, domainMask = null) {
    if (!domainMask) {
        return true;
    }

    if (domainMask.cartesian) {
        if (!isValueWithinDomain(x, domainMask.cartesian.x)) return false;
        if (!isValueWithinDomain(y, domainMask.cartesian.y)) return false;
        if (!isValueWithinDomain(z, domainMask.cartesian.z)) return false;
    }

    if (domainMask.cylindrical) {
        const rho = Math.sqrt(x * x + y * y);
        const theta = Math.atan2(y, x);
        if (!isValueWithinDomain(rho, domainMask.cylindrical.rho)) return false;
        if (!isAngleWithinDomain(theta, domainMask.cylindrical.theta)) return false;
        if (!isValueWithinDomain(z, domainMask.cylindrical.z)) return false;
    }

    if (domainMask.spherical) {
        const radius = Math.sqrt(x * x + y * y + z * z);
        const theta = radius > ZERO_TOLERANCE ? Math.acos(z / radius) : 0;
        const phi = Math.atan2(y, x);
        if (!isValueWithinDomain(radius, domainMask.spherical.radius)) return false;
        if (!isValueWithinDomain(theta, domainMask.spherical.theta)) return false;
        if (!isAngleWithinDomain(phi, domainMask.spherical.phi)) return false;
    }

    return true;
}

function hashSeedValue(value, seed = 2166136261) {
    const text = String(value ?? '');
    let hash = seed >>> 0;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
}

function createDeterministicRandom(seedValue) {
    let state = hashSeedValue(seedValue) || 1;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function createDeterministicStreamlineSeeds(xDomain, yDomain, zDomain, count = 180, seedValue = 'plot3d-streamlines') {
    const [xMin, xMax] = xDomain;
    const [yMin, yMax] = yDomain;
    const [zMin, zMax] = zDomain;
    const random = createDeterministicRandom(`${seedValue}|${xMin},${xMax}|${yMin},${yMax}|${zMin},${zMax}|${count}`);
    const seeds = [];

    for (let i = 0; i < count; i++) {
        seeds.push({
            x: xMin + random() * (xMax - xMin),
            y: yMin + random() * (yMax - yMin),
            z: zMin + random() * (zMax - zMin)
        });
    }

    return seeds;
}

function buildVectorDomainMask(semantics, labeledDomains = {}) {
    if (!semantics || semantics.family !== 'vector') {
        return null;
    }

    const coordSystem = semantics.coordSystem || 'cartesian';
    const coordVars = Array.isArray(semantics.coordVars) ? semantics.coordVars : [];
    const hasOwnRange = (name) => Array.isArray(labeledDomains[name]);
    const isCartesianField = coordVars.length === 3 && coordVars.every((name, index) => ['x', 'y', 'z'][index] === name);
    const useCartesianX = hasOwnRange('x') ? labeledDomains.x : null;
    const useCartesianY = hasOwnRange('y') ? labeledDomains.y : null;
    const useCartesianZ = hasOwnRange('z') ? labeledDomains.z : null;

    const cylindricalRho = hasOwnRange('rho')
        ? labeledDomains.rho
        : (coordSystem === 'cylindrical' && hasOwnRange('r') ? labeledDomains.r : null);

    const sphericalRadius = hasOwnRange('radius')
        ? labeledDomains.radius
        : ((coordSystem === 'spherical' || isCartesianField) && hasOwnRange('r') ? labeledDomains.r : null);

    return {
        cartesian: (useCartesianX || useCartesianY || useCartesianZ)
            ? { x: useCartesianX, y: useCartesianY, z: useCartesianZ }
            : null,
        cylindrical: (cylindricalRho || (coordSystem === 'cylindrical' && (hasOwnRange('theta') || hasOwnRange('z'))))
            ? {
                rho: cylindricalRho,
                theta: coordSystem === 'cylindrical' ? labeledDomains.theta || null : null,
                z: coordSystem === 'cylindrical' ? labeledDomains.z || null : null
            }
            : null,
        spherical: (sphericalRadius || (coordSystem === 'spherical' && (hasOwnRange('theta') || hasOwnRange('phi'))))
            ? {
                radius: sphericalRadius,
                theta: coordSystem === 'spherical' ? labeledDomains.theta || null : null,
                phi: coordSystem === 'spherical' ? labeledDomains.phi || null : null
            }
            : null
    };
}

function resolveVectorSeedBox(domainInfo, customOptions = {}, semantics, vectorDomainMask) {
    const labeledDomains = customOptions.labeledDomains || {};

    if (Array.isArray(labeledDomains.x) && Array.isArray(labeledDomains.y) && Array.isArray(labeledDomains.z)) {
        return {
            xDomain: labeledDomains.x,
            yDomain: labeledDomains.y,
            zDomain: labeledDomains.z
        };
    }

    if (Array.isArray(customOptions.xlim) && Array.isArray(customOptions.ylim) && Array.isArray(customOptions.zlim)) {
        return {
            xDomain: customOptions.xlim,
            yDomain: customOptions.ylim,
            zDomain: customOptions.zlim
        };
    }

    const coordSystem = semantics?.coordSystem || 'cartesian';
    if (coordSystem === 'spherical') {
        const radiusDomain = vectorDomainMask?.spherical?.radius || domainInfo.xDomain;
        const radiusMax = radiusDomain ? Math.max(Math.abs(radiusDomain[0]), Math.abs(radiusDomain[1])) : 5;
        return {
            xDomain: [-radiusMax, radiusMax],
            yDomain: [-radiusMax, radiusMax],
            zDomain: [-radiusMax, radiusMax]
        };
    }

    if (coordSystem === 'cylindrical') {
        const rhoDomain = vectorDomainMask?.cylindrical?.rho || domainInfo.xDomain;
        const rhoMax = rhoDomain ? Math.max(Math.abs(rhoDomain[0]), Math.abs(rhoDomain[1])) : 5;
        const zDomain = vectorDomainMask?.cylindrical?.z || domainInfo.zDomain || [-rhoMax, rhoMax];
        return {
            xDomain: [-rhoMax, rhoMax],
            yDomain: [-rhoMax, rhoMax],
            zDomain: zDomain
        };
    }

    return {
        xDomain: domainInfo.xDomain,
        yDomain: domainInfo.yDomain,
        zDomain: domainInfo.zDomain || domainInfo.xDomain
    };
}

function appendEvolutionLatex(latexText, evolutionVar, evolutionValue) {
    if (!evolutionVar || typeof evolutionValue !== 'number' || !isFinite(evolutionValue)) {
        return latexText;
    }
    const formattedVar = formatVarToTex(evolutionVar);
    return `${latexText}\\quad (${formattedVar} = ${evolutionValue.toFixed(2)})`;
}

function getPlot3dTraceVariables(semantics) {
    switch (semantics.family) {
        case 'vector':
            // Vector fields treat animate:<var> as a coefficient/domain sweep, not
            // as a streamline "reveal" trace. Returning no trace variables keeps
            // coord vars like phi available for true evolution animation.
            return [];
        case 'surface-parametric':
        case 'surface-polar':
            return semantics.paramVars || [];
        case 'curve-parametric':
            return semantics.paramVar ? [semantics.paramVar] : [];
        case 'surface-explicit':
            return semantics.surfaceVars || [];
        case 'surface-implicit':
            return semantics.coordVars || [];
        case 'curve-explicit-2d':
            return [semantics.independentVar, semantics.dependentVar].filter(Boolean);
        case 'curve-implicit-2d':
            return semantics.coordVars || [];
        case 'curve-polar-2d':
            return semantics.angleVar ? [semantics.angleVar] : [];
        default:
            return ['x', 'y', 'z'];
    }
}

function getDefaultPlot3dEvolutionVar(expr, traceVars) {
    if (/\bt\b/i.test(expr) && !traceVars.includes('t')) {
        return 't';
    }
    return traceVars[0] || 't';
}

function evaluateImplicitSurfaceValue(compiled, coordSystem, coordVars, opts, x, y, z) {
    const [xVar, yVar, zVar] = coordVars;

    try {
        if (coordSystem === 'spherical') {
            const r = Math.sqrt(x * x + y * y + z * z);
            const theta = r > ZERO_TOLERANCE ? Math.acos(z / r) : 0;
            const phi = Math.atan2(y, x);
            return toReal(compiled.evaluate(mergeEvalScope(opts, {
                x,
                y,
                z,
                [xVar]: x,
                [yVar]: y,
                [zVar]: z,
                r,
                theta,
                phi
            })));
        }

        if (coordSystem === 'cylindrical') {
            const r = Math.sqrt(x * x + y * y);
            const theta = Math.atan2(y, x);
            return toReal(compiled.evaluate(mergeEvalScope(opts, {
                x,
                y,
                z,
                [xVar]: x,
                [yVar]: y,
                [zVar]: z,
                r,
                theta
            })));
        }

        return toReal(compiled.evaluate(mergeEvalScope(opts, {
            x,
            y,
            z,
            [xVar]: x,
            [yVar]: y,
            [zVar]: z
        })));
    } catch (e) {
        return NaN;
    }
}

function resolvePlot3dTraceBounds(tracingVar, domainInfo) {
    return domainInfo.traceDomainMap[tracingVar] || null;
}

function resolvePlot3dDomains({
    customOptions,
    domains,
    graphStyle,
    semantics,
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
            providedDomains: { x: true, y: true, z: true },
            traceDomainMap: {}
        };
    }

    const labeled = customOptions.labeledDomains || {};
    let positionalConsumed = 0;
    const providedDomains = { x: false, y: false, z: false };

    function resolveDomainForVar(varNames, fallbackDefault) {
        const names = Array.isArray(varNames) ? varNames : [varNames];
        for (const name of names) {
            if (labeled[name]) {
                if (['x', 'y', 'z'].includes(name)) {
                    providedDomains[name] = true;
                }
                return labeled[name];
            }
        }
        if (positionalConsumed < domains.length) {
            const domain = domains[positionalConsumed];
            positionalConsumed++;
            for (const name of names) {
                if (['x', 'y', 'z'].includes(name)) {
                    providedDomains[name] = true;
                }
            }
            return domain;
        }
        return typeof fallbackDefault === 'function' ? fallbackDefault() : fallbackDefault;
    }

    let xDomain;
    let yDomain;
    let zDomain;
    let parameterDomain1 = null;
    let parameterDomain2 = null;
    let evolutionDomain = null;
    const traceDomainMap = {};

    const evolutionVar = customOptions.evolutionVar || 't';

    if (semantics.family === 'vector') {
        xDomain = resolveDomainForVar(semantics.coordVars[0], defaultXDomain);
        yDomain = resolveDomainForVar(semantics.coordVars[1], () => [...xDomain]);
        zDomain = resolveDomainForVar(semantics.coordVars[2], () => [...xDomain]);
        traceDomainMap[semantics.coordVars[0]] = xDomain;
        traceDomainMap[semantics.coordVars[1]] = yDomain;
        traceDomainMap[semantics.coordVars[2]] = zDomain;
        evolutionDomain = hasEvolutionSweep ? resolveDomainForVar(evolutionVar, defaultEvolutionDomain) : null;
    } else if (semantics.family === 'surface-parametric' || semantics.family === 'surface-polar') {
        const coordSystem = semantics.coordSystem || 'cartesian';
        const defaultU = coordSystem === 'spherical' ? [0, Math.PI] : [0, 2 * Math.PI];
        const defaultV = coordSystem === 'spherical'
            ? [0, 2 * Math.PI]
            : (coordSystem === 'cylindrical' ? [-5, 5] : [0, 2 * Math.PI]);

        parameterDomain1 = resolveDomainForVar(semantics.paramVars[0], defaultU);
        parameterDomain2 = resolveDomainForVar(semantics.paramVars[1], defaultV);
        traceDomainMap[semantics.paramVars[0]] = parameterDomain1;
        traceDomainMap[semantics.paramVars[1]] = parameterDomain2;
        evolutionDomain = hasEvolutionSweep ? resolveDomainForVar(evolutionVar, defaultEvolutionDomain) : null;

        xDomain = resolveDomainForVar('x', defaultXDomain);
        yDomain = resolveDomainForVar('y', () => [...xDomain]);
        zDomain = resolveDomainForVar('z', null);
    } else if (semantics.family === 'curve-parametric') {
        parameterDomain1 = resolveDomainForVar(semantics.paramVar, [0, 2 * Math.PI]);
        traceDomainMap[semantics.paramVar] = parameterDomain1;
        evolutionDomain = hasEvolutionSweep ? resolveDomainForVar(evolutionVar, defaultEvolutionDomain) : null;

        xDomain = resolveDomainForVar('x', defaultXDomain);
        yDomain = resolveDomainForVar('y', () => [...xDomain]);
        zDomain = resolveDomainForVar('z', [-1, 1]);
    } else if (semantics.family === 'surface-implicit') {
        xDomain = resolveDomainForVar(semantics.coordVars[0], defaultXDomain);
        yDomain = resolveDomainForVar(semantics.coordVars[1], defaultYDomain);
        zDomain = resolveDomainForVar(semantics.coordVars[2], null);
        traceDomainMap[semantics.coordVars[0]] = xDomain;
        traceDomainMap[semantics.coordVars[1]] = yDomain;
        if (zDomain) {
            traceDomainMap[semantics.coordVars[2]] = zDomain;
        }
        evolutionDomain = hasEvolutionSweep ? resolveDomainForVar(evolutionVar, defaultEvolutionDomain) : null;
    } else if (semantics.family === 'surface-explicit') {
        xDomain = resolveDomainForVar(semantics.surfaceVars[0], defaultXDomain);
        yDomain = resolveDomainForVar(semantics.surfaceVars[1], defaultYDomain);
        zDomain = resolveDomainForVar('z', null);
        traceDomainMap[semantics.surfaceVars[0]] = xDomain;
        traceDomainMap[semantics.surfaceVars[1]] = yDomain;
        evolutionDomain = hasEvolutionSweep ? resolveDomainForVar(evolutionVar, defaultEvolutionDomain) : null;
    } else if (semantics.family === 'curve-explicit-2d') {
        xDomain = resolveDomainForVar(semantics.independentVar, defaultXDomain);
        yDomain = resolveDomainForVar(semantics.dependentVar, defaultYDomain);
        zDomain = resolveDomainForVar('z', [-1, 1]);
        traceDomainMap[semantics.independentVar] = xDomain;
        traceDomainMap[semantics.dependentVar] = yDomain;
        evolutionDomain = hasEvolutionSweep ? resolveDomainForVar(evolutionVar, defaultEvolutionDomain) : null;
    } else if (semantics.family === 'curve-implicit-2d') {
        xDomain = resolveDomainForVar(semantics.coordVars[0], defaultXDomain);
        yDomain = resolveDomainForVar(semantics.coordVars[1], defaultYDomain);
        zDomain = resolveDomainForVar('z', [-1, 1]);
        traceDomainMap[semantics.coordVars[0]] = xDomain;
        traceDomainMap[semantics.coordVars[1]] = yDomain;
        evolutionDomain = hasEvolutionSweep ? resolveDomainForVar(evolutionVar, defaultEvolutionDomain) : null;
    } else if (semantics.family === 'curve-polar-2d') {
        parameterDomain1 = resolveDomainForVar(semantics.angleVar, [0, 2 * Math.PI]);
        xDomain = resolveDomainForVar('x', defaultXDomain);
        yDomain = resolveDomainForVar('y', defaultYDomain);
        zDomain = resolveDomainForVar('z', [-1, 1]);
        traceDomainMap[semantics.angleVar] = parameterDomain1;
        evolutionDomain = hasEvolutionSweep ? resolveDomainForVar(evolutionVar, defaultEvolutionDomain) : null;
    } else {
        xDomain = resolveDomainForVar('x', defaultXDomain);
        yDomain = resolveDomainForVar('y', defaultYDomain);
        if (hasEvolutionSweep) {
            evolutionDomain = resolveDomainForVar(evolutionVar, defaultEvolutionDomain);
            zDomain = resolveDomainForVar('z', null);
        } else {
            zDomain = resolveDomainForVar('z', null);
        }
    }

    return {
        xDomain,
        yDomain,
        zDomain,
        parameterDomain1,
        parameterDomain2,
        evolutionDomain,
        providedDomains,
        traceDomainMap
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



function shouldTreatBareTupleAsVector(components, domainsCount) {
    const hasUV = components.some(c => expressionUsesAnySymbol(c, ['u', 'v']));
    if (hasUV) return false;
    const hasT = components.some(c => expressionUsesAnySymbol(c, ['t']));
    const hasXYZ = components.some(c => expressionUsesAnySymbol(c, ['x', 'y', 'z', 'r', 'theta', 'phi']));
    if (hasT && !hasXYZ) {
        return false;
    }
    if (domainsCount >= 2) {
        return true;
    }
    return hasXYZ;
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

function sampleVectorField3d(components, opts, coordSystem = 'cartesian', coordVars = ['x', 'y', 'z']) {
    const [xExpr, yExpr, zExpr] = components;
    const [xVar, yVar, zVar] = coordVars;
    const xCompiled = math.compile(preprocessExpr(xExpr));
    const yCompiled = math.compile(preprocessExpr(yExpr));
    const zCompiled = math.compile(preprocessExpr(zExpr));
    const vectorDomainMask = opts.vectorDomainMask || null;

    const [d1Min, d1Max] = opts.xDomain;
    const [d2Min, d2Max] = opts.yDomain;
    const [d3Min, d3Max] = opts.zDomain;

    const steps = 5;
    const points = [];
    let maxMag = 0;

    for (let i = 0; i <= steps; i++) {
        const v1 = d1Min + i * (d1Max - d1Min) / steps;
        for (let j = 0; j <= steps; j++) {
            const v2 = d2Min + j * (d2Max - d2Min) / steps;
            for (let k = 0; k <= steps; k++) {
                const v3 = d3Min + k * (d3Max - d3Min) / steps;

                let x, y, z;
                if (coordSystem === 'cylindrical') {
                    const r = v1;
                    const theta = v2;
                    x = r * Math.cos(theta);
                    y = r * Math.sin(theta);
                    z = v3;
                } else if (coordSystem === 'spherical') {
                    const r = v1;
                    const theta = v2;
                    const phi = v3;
                    x = r * Math.sin(theta) * Math.cos(phi);
                    y = r * Math.sin(theta) * Math.sin(phi);
                    z = r * Math.cos(theta);
                } else {
                    x = v1;
                    y = v2;
                    z = v3;
                }

                if (!pointPassesVectorDomainMask(x, y, z, vectorDomainMask)) {
                    continue;
                }

                if (shouldSkipCartesianPoint(opts, x, y, z)) {
                    continue;
                }

                try {
                    let uVal, vVal, wVal;
                    if (coordSystem === 'cylindrical') {
                        const r = v1;
                        const theta = v2;
                        const scope = mergeEvalScope(opts, { x, y, z, [xVar]: r, [yVar]: theta, [zVar]: z, r, theta });
                        const Fr = toReal(xCompiled.evaluate(scope));
                        const Ftheta = toReal(yCompiled.evaluate(scope));
                        const Fz = toReal(zCompiled.evaluate(scope));
                        
                        uVal = Fr * Math.cos(theta) - Ftheta * Math.sin(theta);
                        vVal = Fr * Math.sin(theta) + Ftheta * Math.cos(theta);
                        wVal = Fz;
                    } else if (coordSystem === 'spherical') {
                        const r = v1;
                        const theta = v2;
                        const phi = v3;
                        const scope = mergeEvalScope(opts, { x, y, z, [xVar]: r, [yVar]: theta, [zVar]: phi, r, theta, phi });
                        const Fr = toReal(xCompiled.evaluate(scope));
                        const Ftheta = toReal(yCompiled.evaluate(scope));
                        const Fphi = toReal(zCompiled.evaluate(scope));
                        
                        uVal = Fr * Math.sin(theta) * Math.cos(phi) + Ftheta * Math.cos(theta) * Math.cos(phi) - Fphi * Math.sin(phi);
                        vVal = Fr * Math.sin(theta) * Math.sin(phi) + Ftheta * Math.cos(theta) * Math.sin(phi) + Fphi * Math.cos(phi);
                        wVal = Fr * Math.cos(theta) - Ftheta * Math.sin(theta);
                    } else {
                        const scope = mergeEvalScope(opts, { x, y, z, [xVar]: x, [yVar]: y, [zVar]: z });
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

    const [xLimMin, xLimMax] = opts.xLim || [-5, 5];
    const [yLimMin, yLimMax] = opts.yLim || [-5, 5];
    const [zLimMin, zLimMax] = opts.zLim || [-5, 5];
    const viewSpacing = Math.min(
        (xLimMax - xLimMin) / steps,
        (yLimMax - yLimMin) / steps,
        (zLimMax - zLimMin) / steps
    );
    const safeSpacing = Number.isFinite(viewSpacing) && viewSpacing > ZERO_TOLERANCE ? viewSpacing : 1;
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

function sampleFluxLines3d(components, opts, coordSystem = 'cartesian', coordVars = ['x', 'y', 'z']) {
    const [xExpr, yExpr, zExpr] = components;
    const [xVar, yVar, zVar] = coordVars;
    const xCompiled = math.compile(preprocessExpr(xExpr));
    const yCompiled = math.compile(preprocessExpr(yExpr));
    const zCompiled = math.compile(preprocessExpr(zExpr));
    const vectorDomainMask = opts.vectorDomainMask || null;

    const evalVectorField = (x, y, z) => {
        if (shouldSkipCartesianPoint(opts, x, y, z)) {
            return null;
        }

        if (!pointPassesVectorDomainMask(x, y, z, vectorDomainMask)) {
            return null;
        }

        try {
            let uVal, vVal, wVal;
            if (coordSystem === 'cylindrical') {
                const r = Math.sqrt(x*x + y*y);
                const theta = Math.atan2(y, x);
                const scope = mergeEvalScope(opts, { x, y, z, [xVar]: r, [yVar]: theta, [zVar]: z, r, theta });
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
                const scope = mergeEvalScope(opts, { x, y, z, [xVar]: r, [yVar]: theta, [zVar]: phi, r, theta, phi });
                const Fr = toReal(xCompiled.evaluate(scope));
                const Ftheta = toReal(yCompiled.evaluate(scope));
                const Fphi = toReal(zCompiled.evaluate(scope));
                
                uVal = Fr * Math.sin(theta) * Math.cos(phi) + Ftheta * Math.cos(theta) * Math.cos(phi) - Fphi * Math.sin(phi);
                vVal = Fr * Math.sin(theta) * Math.sin(phi) + Ftheta * Math.cos(theta) * Math.sin(phi) + Fphi * Math.cos(phi);
                wVal = Fr * Math.cos(theta) - Ftheta * Math.sin(theta);
            } else {
                const scope = mergeEvalScope(opts, { x, y, z, [xVar]: x, [yVar]: y, [zVar]: z });
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

    const seeds = opts.streamlineSeeds || createDeterministicStreamlineSeeds(opts.xLim || opts.xDomain, opts.yLim || opts.yDomain, opts.zLim || opts.zDomain);

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

    const [xLimMin, xLimMax] = opts.xLim || [-5, 5];
    const [yLimMin, yLimMax] = opts.yLim || [-5, 5];
    const [zLimMin, zLimMax] = opts.zLim || [-5, 5];

    // Calculate dynamic step size based on viewport diagonal size
    const diag = Math.sqrt((xLimMax - xLimMin) ** 2 + (yLimMax - yLimMin) ** 2 + (zLimMax - zLimMin) ** 2);
    const h = 0.015 * diag;
    const maxSteps = 80;

    // Small boundary margin of 10% to let lines exit nicely
    const xMargin = (xLimMax - xLimMin) * 0.1;
    const yMargin = (yLimMax - yLimMin) * 0.1;
    const zMargin = (zLimMax - zLimMin) * 0.1;

    const xBoundMin = xLimMin - xMargin;
    const xBoundMax = xLimMax + xMargin;
    const yBoundMin = yLimMin - yMargin;
    const yBoundMax = yLimMax + yMargin;
    const zBoundMin = zLimMin - zMargin;
    const zBoundMax = zLimMax + zMargin;

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

    const validMags = colors.filter(val => val !== null).sort((a, b) => a - b);
    let scaleMaxMag = globalMaxMag;
    if (validMags.length > 0) {
        const pct90Idx = Math.floor(validMags.length * 0.90);
        scaleMaxMag = validMags[pct90Idx];
        if (scaleMaxMag <= ZERO_TOLERANCE) {
            scaleMaxMag = globalMaxMag;
        }
    }

    const normColors = colors.map(val => {
        if (val === null) return null;
        const capped = Math.min(val, scaleMaxMag);
        return scaleMaxMag > ZERO_TOLERANCE ? capped / scaleMaxMag : 0;
    });

    const scaledConeU = [];
    const scaledConeV = [];
    const scaledConeW = [];
    for (let i = 0; i < coneX.length; i++) {
        const cappedMag = Math.min(coneMags[i], scaleMaxMag);
        const factor = scaleMaxMag > ZERO_TOLERANCE ? cappedMag / scaleMaxMag : 0;
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

function getAxisDomainKey(axisName) {
    return `${axisName}Domain`;
}

function getSurfaceParameterAxes(solvedAxis) {
    if (solvedAxis === 'x') {
        return ['y', 'z'];
    }
    if (solvedAxis === 'y') {
        return ['x', 'z'];
    }
    return ['x', 'y'];
}

function getAxisDomainOrFallback(opts, axisName) {
    const domainKey = getAxisDomainKey(axisName);
    if (Array.isArray(opts[domainKey])) {
        return opts[domainKey];
    }

    if (axisName === 'z' && Array.isArray(opts.xDomain)) {
        opts[domainKey] = [...opts.xDomain];
        return opts[domainKey];
    }

    opts[domainKey] = [-5, 5];
    return opts[domainKey];
}

function buildExplicitSurfaceFromLinearAxis(combinedExpr, opts, providedDomains = {}) {
    const combinedNode = math.parse(combinedExpr);
    const axisOrder = ['z', 'y', 'x'];

    for (const solvedAxis of axisOrder) {
        const coeffNode = math.simplify(math.derivative(combinedNode, solvedAxis));
        if (isZeroNode(coeffNode)) {
            continue;
        }

        const secondDerivative = math.simplify(math.derivative(coeffNode, solvedAxis));
        if (!isZeroNode(secondDerivative)) {
            continue;
        }

        const freeNode = math.simplify(substituteSymbolWithZero(combinedNode, solvedAxis));
        const coeffCompiled = coeffNode.compile();
        const freeCompiled = freeNode.compile();
        const [paramAxis1, paramAxis2] = getSurfaceParameterAxes(solvedAxis);
        const paramDomain1 = getAxisDomainOrFallback(opts, paramAxis1);
        const paramDomain2 = getAxisDomainOrFallback(opts, paramAxis2);
        const [uMin, uMax] = paramDomain1;
        const [vMin, vMax] = paramDomain2;
        const gridSteps = 40;
        const uValues = [];
        const vValues = [];

        for (let i = 0; i <= gridSteps; i++) {
            uValues.push(uMin + i * (uMax - uMin) / gridSteps);
        }
        for (let j = 0; j <= gridSteps; j++) {
            vValues.push(vMin + j * (vMax - vMin) / gridSteps);
        }

        const xGrid = [];
        const yGrid = [];
        const zGrid = [];
        const solvedValues = [];

        for (let j = 0; j <= gridSteps; j++) {
            const rowX = [];
            const rowY = [];
            const rowZ = [];
            const v = vValues[j];

            for (let i = 0; i <= gridSteps; i++) {
                const u = uValues[i];

                try {
                    const scope = mergeEvalScope(opts, {
                        [paramAxis1]: u,
                        [paramAxis2]: v
                    });
                    const coeffValue = toReal(coeffCompiled.evaluate(scope));
                    const freeValue = toReal(freeCompiled.evaluate(scope));

                    if (!isNaN(coeffValue) && isFinite(coeffValue) && Math.abs(coeffValue) > ZERO_TOLERANCE && !isNaN(freeValue) && isFinite(freeValue)) {
                        const solvedValue = -freeValue / coeffValue;
                        const point = {
                            x: solvedAxis === 'x' ? solvedValue : (paramAxis1 === 'x' ? u : v),
                            y: solvedAxis === 'y' ? solvedValue : (paramAxis1 === 'y' ? u : v),
                            z: solvedAxis === 'z' ? solvedValue : (paramAxis1 === 'z' ? u : v)
                        };

                        if (
                            !isNaN(point.x) && isFinite(point.x) &&
                            !isNaN(point.y) && isFinite(point.y) &&
                            !isNaN(point.z) && isFinite(point.z) &&
                            !isTracingLimited(opts, 'x', point.x) &&
                            !isTracingLimited(opts, 'y', point.y) &&
                            !isTracingLimited(opts, 'z', point.z)
                        ) {
                            rowX.push(point.x);
                            rowY.push(point.y);
                            rowZ.push(point.z);
                            solvedValues.push(solvedValue);
                            continue;
                        }
                    }
                } catch (err) { }

                rowX.push(null);
                rowY.push(null);
                rowZ.push(null);
            }

            xGrid.push(rowX);
            yGrid.push(rowY);
            zGrid.push(rowZ);
        }

        if (solvedValues.length === 0) {
            continue;
        }

        const solvedDomainKey = getAxisDomainKey(solvedAxis);
        if (!providedDomains[solvedAxis]) {
            const solvedMin = Math.min(...solvedValues);
            const solvedMax = Math.max(...solvedValues);
            const margin = (solvedMax - solvedMin) * 0.1 || 0.5;
            opts[solvedDomainKey] = [solvedMin - margin, solvedMax + margin];
        }

        let latexText = '';
        try {
            const explicitNode = math.simplify(`-(${freeNode.toString()}) / (${coeffNode.toString()})`);
            latexText = `${solvedAxis} = ${explicitNode.toTex()}`;
        } catch (err) { }

        return {
            type: 'surface',
            plotData: { x: xGrid, y: yGrid, z: zGrid },
            latexText,
            solvedAxis
        };
    }

    return null;
}

function sampleExplicitPlaneCurve3d(rhsExpr, independentVar, dependentVar, opts) {
    const compiled = math.compile(preprocessExpr(rhsExpr));
    const [xMin, xMax] = opts.xDomain;
    const [yMin, yMax] = opts.yDomain;
    const steps = 400;
    const step = (xMax - xMin) / steps;
    const points = [];

    function evalAt(x) {
        try {
            const scope = mergeEvalScope(opts, { x, [independentVar]: x });
            const value = toReal(compiled.evaluate(scope));
            if (!isNaN(value) && isFinite(value) && !isTracingLimited(opts, dependentVar, value)) {
                return value;
            }
        } catch (_) { }
        return null;
    }

    const maxDepth = 12;
    const minXDist = (xMax - xMin) / 1000000;
    const yRange = yMax - yMin;
    const threshY = yRange * 0.01;
    const nearDomain = (y) => y !== null && y >= yMin - yRange && y <= yMax + yRange;

    function subdivide(x1, y1, x2, y2, depth) {
        let shouldSplit = false;
        let yMid = null;
        const xMid = (x1 + x2) / 2;

        if (depth < maxDepth && Math.abs(x2 - x1) >= minXDist) {
            yMid = evalAt(xMid);

            if (y1 === null && y2 === null) {
                if (yMid !== null) shouldSplit = true;
            } else if (y1 === null || y2 === null) {
                shouldSplit = true;
            } else {
                const diff = Math.abs(y1 - y2);
                if (diff > threshY && (nearDomain(y1) || nearDomain(y2) || nearDomain(yMid))) {
                    shouldSplit = true;
                }
            }
        }

        if (shouldSplit) {
            subdivide(x1, y1, xMid, yMid, depth + 1);
            subdivide(xMid, yMid, x2, y2, depth + 1);
        } else {
            points.push({ x: x2, y: y2 });
        }
    }

    const yStart = evalAt(xMin);
    points.push({ x: xMin, y: yStart });

    const limitX = isTracingLimited(opts, independentVar, xMax) ? opts.tracingLimit : xMax;
    for (let i = 0; i < steps; i++) {
        const x1 = xMin + i * step;
        const x2 = xMin + (i + 1) * step;
        if (x2 > limitX) break;
        const y1 = points[points.length - 1].y;
        const y2 = evalAt(x2);
        subdivide(x1, y1, x2, y2, 0);
    }

    return {
        x: points.map((point) => point.x),
        y: points.map((point) => point.y),
        z: points.map(() => 0)
    };
}

function samplePolarPlaneCurve3d(rhsExpr, angleVar, opts) {
    const compiled = math.compile(preprocessExpr(rhsExpr));
    const [thetaMin, thetaMax] = opts.parameterDomain1 || [0, 2 * Math.PI];
    const steps = 500;
    const step = (thetaMax - thetaMin) / steps;
    const x = [];
    const y = [];
    const z = [];
    const limitTheta = isTracingLimited(opts, angleVar, thetaMax) ? opts.tracingLimit : thetaMax;

    for (let i = 0; i <= steps; i++) {
        const theta = thetaMin + i * step;
        if (theta > limitTheta) break;

        try {
            const scope = mergeEvalScope(opts, { theta, [angleVar]: theta });
            const rValue = toReal(compiled.evaluate(scope));
            if (!isNaN(rValue) && isFinite(rValue)) {
                x.push(rValue * Math.cos(theta));
                y.push(rValue * Math.sin(theta));
                z.push(0);
            } else {
                x.push(null);
                y.push(null);
                z.push(null);
            }
        } catch (_) {
            x.push(null);
            y.push(null);
            z.push(null);
        }
    }

    return { x, y, z };
}

function sampleImplicitPlaneCurve3d(lhsExpr, rhsExpr, coordVars, opts, extraScope = () => ({})) {
    const combined = `(${preprocessExpr(lhsExpr)}) - (${preprocessExpr(rhsExpr)})`;
    const compiled = math.compile(combined);
    const [xVar, yVar] = coordVars;
    const [xMin, xMax] = opts.xDomain;
    const [yMin, yMax] = opts.yDomain;
    const steps = 150;
    const xStep = (xMax - xMin) / steps;
    const yStep = (yMax - yMin) / steps;
    const X = [];
    const Y = [];

    for (let i = 0; i <= steps; i++) {
        X.push(xMin + i * xStep);
        Y.push(yMin + i * yStep);
    }

    const V = [];
    for (let i = 0; i <= steps; i++) {
        const row = [];
        const x = X[i];
        const skipX = isTracingLimited(opts, xVar, x);
        for (let j = 0; j <= steps; j++) {
            const y = Y[j];
            const skipY = isTracingLimited(opts, yVar, y);
            if (skipX || skipY) {
                row.push(NaN);
                continue;
            }

            try {
                const r = Math.sqrt(x * x + y * y);
                const theta = Math.atan2(y, x);
                const scope = mergeEvalScope(opts, Object.assign({
                    x,
                    y,
                    [xVar]: x,
                    [yVar]: y,
                    r,
                    theta
                }, extraScope(theta)));
                const value = toReal(compiled.evaluate(scope));
                row.push(!isNaN(value) && isFinite(value) ? value : NaN);
            } catch (_) {
                row.push(NaN);
            }
        }
        V.push(row);
    }

    const lineX = [];
    const lineY = [];
    const lineZ = [];

    for (let i = 0; i < steps; i++) {
        for (let j = 0; j < steps; j++) {
            const v00 = V[i][j];
            const v10 = V[i + 1][j];
            const v11 = V[i + 1][j + 1];
            const v01 = V[i][j + 1];

            if (isNaN(v00) || isNaN(v10) || isNaN(v11) || isNaN(v01)) {
                continue;
            }

            const crossings = [];
            if (v00 * v10 <= 0 && v00 !== v10) {
                const t = -v00 / (v10 - v00);
                crossings.push({ x: X[i] + t * (X[i + 1] - X[i]), y: Y[j] });
            }
            if (v10 * v11 <= 0 && v10 !== v11) {
                const t = -v10 / (v11 - v10);
                crossings.push({ x: X[i + 1], y: Y[j] + t * (Y[j + 1] - Y[j]) });
            }
            if (v01 * v11 <= 0 && v01 !== v11) {
                const t = -v01 / (v11 - v01);
                crossings.push({ x: X[i] + t * (X[i + 1] - X[i]), y: Y[j + 1] });
            }
            if (v00 * v01 <= 0 && v00 !== v01) {
                const t = -v00 / (v01 - v00);
                crossings.push({ x: X[i], y: Y[j] + t * (Y[j + 1] - Y[j]) });
            }

            if (crossings.length === 2) {
                lineX.push(crossings[0].x, crossings[1].x, null);
                lineY.push(crossings[0].y, crossings[1].y, null);
                lineZ.push(0, 0, null);
            } else if (crossings.length === 4) {
                lineX.push(crossings[0].x, crossings[1].x, null, crossings[2].x, crossings[3].x, null);
                lineY.push(crossings[0].y, crossings[1].y, null, crossings[2].y, crossings[3].y, null);
                lineZ.push(0, 0, null, 0, 0, null);
            }
        }
    }

    return { x: lineX, y: lineY, z: lineZ };
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
        semantics,
        parameterDomain1,
        parameterDomain2,
        providedDomains
    } = context;
    const coordSystem = semantics.coordSystem || 'cartesian';

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

    if (semantics.family === 'vector') {
        const isFlux = customOptions.isFlux || false;
        type = isFlux ? 'flux3d' : 'vector3d';
        const fieldName = semantics.funcName || 'F';
        const components = semantics.components;
        const [xVar, yVar, zVar] = semantics.coordVars;

        if (!opts.zDomain) {
            opts.zDomain = [...opts.xDomain];
        }

        plotData = isFlux
            ? sampleFluxLines3d(components, opts, coordSystem, semantics.coordVars)
            : sampleVectorField3d(components, opts, coordSystem, semantics.coordVars);
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
            const texXVar = formatVarToTex(xVar);
            const texYVar = formatVarToTex(yVar);
            const texZVar = formatVarToTex(zVar);
            if (coordSystem === 'cylindrical') {
                latexText = `\\vec{${fieldName}}(${texXVar},${texYVar},${texZVar}) = \\begin{pmatrix} ${texU} \\\\ ${texV} \\\\ ${texW} \\end{pmatrix}`;
            } else if (coordSystem === 'spherical') {
                latexText = `\\vec{${fieldName}}(${texXVar},${texYVar},${texZVar}) = \\begin{pmatrix} ${texU} \\\\ ${texV} \\\\ ${texW} \\end{pmatrix}`;
            } else {
                latexText = `\\vec{${fieldName}}(${texXVar},${texYVar},${texZVar}) = \\begin{pmatrix} ${texU} \\\\ ${texV} \\\\ ${texW} \\end{pmatrix}`;
            }
        } catch (e) {
            latexText = `\\vec{${fieldName}} = \\left( ${components.join(', ')} \\right)`;
        }

        return { success: true, type, plotData, latexText };
    }

    if (semantics.family === 'surface-parametric') {
        type = 'surface';
        const [xExpr, yExpr, zExpr] = semantics.components.map((value) => value.trim());
        const [uVar, vVar] = semantics.paramVars;
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
                if (isTracingLimited(opts, uVar, u) || isTracingLimited(opts, vVar, v)) {
                    rowX.push(null);
                    rowY.push(null);
                    rowZ.push(null);
                    continue;
                }

                try {
                    const scope = mergeEvalScope(opts, { u, v, [uVar]: u, [vVar]: v });
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
        if (!providedDomains.z) opts.zDomain = getBounds(flatZ, [-5, 5]);

        try {
            const texX = math.parse(xExpr).toTex();
            const texY = math.parse(yExpr).toTex();
            const texZ = math.parse(zExpr).toTex();
            const texUVar = formatVarToTex(uVar);
            const texVVar = formatVarToTex(vVar);
            latexText = `\\vec{r}(${texUVar},${texVVar}) = \\begin{pmatrix} ${texX} \\\\ ${texY} \\\\ ${texZ} \\end{pmatrix}`;
        } catch (e) {
            const texUVar = formatVarToTex(uVar);
            const texVVar = formatVarToTex(vVar);
            latexText = `\\vec{r}(${texUVar},${texVVar}) = \\left( ${xExpr},\\ ${yExpr},\\ ${zExpr} \\right)`;
        }

        return { success: true, type, plotData, latexText };
    }

    if (semantics.family === 'surface-polar') {
        type = 'surface';
        const rCompiled = math.compile(preprocessExpr(semantics.rhs));
        const [uVar, vVar] = semantics.paramVars;
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
                    ? isTracingLimited(opts, uVar, u) || isTracingLimited(opts, vVar, v)
                    : isTracingLimited(opts, uVar, u) || isTracingLimited(opts, vVar, v);
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
                        const scope = mergeEvalScope(opts, { theta: u, phi: v, [uVar]: u, [vVar]: v });
                        rVal = toReal(rCompiled.evaluate(scope));
                        if (!isNaN(rVal) && isFinite(rVal)) {
                            xVal = rVal * Math.sin(u) * Math.cos(v);
                            yVal = rVal * Math.sin(u) * Math.sin(v);
                            zVal = rVal * Math.cos(u);
                        }
                    } else {
                        const scope = mergeEvalScope(opts, { theta: u, z: v, [uVar]: u, [vVar]: v });
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
        if (!providedDomains.z) opts.zDomain = getBounds(flatZ, [-5, 5]);

        try {
            const texR = math.parse(semantics.rhs).toTex();
            latexText = `${semantics.lhs} = ${texR}`;
        } catch (e) {
            latexText = `${semantics.lhs} = ${semantics.rhs}`;
        }

        return { success: true, type, plotData, latexText };
    }

    if (semantics.family === 'curve-parametric') {
        type = 'curve';
        const [xExpr, yExpr, zExpr] = semantics.components.map((value) => value.trim());
        const paramVar = semantics.paramVar;
        const xCompiled = math.compile(preprocessExpr(xExpr));
        const yCompiled = math.compile(preprocessExpr(yExpr));
        const zCompiled = math.compile(preprocessExpr(zExpr));

        const [tMin, tMax] = parameterDomain1 || [0, 2 * Math.PI];
        const steps = 250;
        const tStep = (tMax - tMin) / steps;
        const limitT = (opts.tracingVar === paramVar && opts.tracingLimit !== undefined) ? Math.min(opts.tracingLimit, tMax) : tMax;

        const xVals = [];
        const yVals = [];
        const zVals = [];

        for (let i = 0; i <= steps; i++) {
            const t = tMin + i * tStep;
            if (t > limitT) break;

            try {
                const scope = mergeEvalScope(opts, { t, [paramVar]: t });
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
        if (!providedDomains.z) opts.zDomain = getBounds(zVals, [-5, 5]);

        try {
            const texX = math.parse(xExpr).toTex();
            const texY = math.parse(yExpr).toTex();
            const texZ = math.parse(zExpr).toTex();
            const texParamVar = formatVarToTex(paramVar);
            latexText = `\\vec{r}(${texParamVar}) = \\begin{pmatrix} ${texX} \\\\ ${texY} \\\\ ${texZ} \\end{pmatrix}`;
        } catch (e) {
            const texParamVar = formatVarToTex(paramVar);
            latexText = `\\vec{r}(${texParamVar}) = \\left( ${xExpr}, ${yExpr}, ${zExpr} \\right)`;
        }

        return { success: true, type, plotData, latexText };
    }

    if (semantics.family === 'curve-explicit-2d') {
        type = 'curve';
        plotData = sampleExplicitPlaneCurve3d(
            semantics.rhs,
            semantics.independentVar,
            semantics.dependentVar,
            opts
        );

        const finiteX = plotData.x.filter((value) => value !== null && isFinite(value));
        const finiteY = plotData.y.filter((value) => value !== null && isFinite(value));
        if (finiteX.length === 0) {
            return {
                success: false,
                error: 'No valid real numbers were computed for this curve. Check if the function is defined on the given domain.'
            };
        }

        if (!providedDomains.x) opts.xDomain = getBounds(finiteX, [-5, 5]);
        if (!providedDomains.y) opts.yDomain = getBounds(finiteY, [-5, 5]);
        if (!providedDomains.z) opts.zDomain = [-0.5, 0.5];

        try {
            latexText = `${semantics.lhs} = ${math.parse(semantics.rhs).toTex()}`;
        } catch (e) {
            latexText = `${semantics.lhs} = ${semantics.rhs}`;
        }

        return { success: true, type, plotData, latexText };
    }

    if (semantics.family === 'curve-polar-2d') {
        type = 'curve';
        plotData = samplePolarPlaneCurve3d(semantics.rhs, semantics.angleVar, Object.assign({}, opts, {
            parameterDomain1
        }));

        const finiteX = plotData.x.filter((value) => value !== null && isFinite(value));
        const finiteY = plotData.y.filter((value) => value !== null && isFinite(value));
        if (finiteX.length === 0) {
            return {
                success: false,
                error: 'No valid real numbers were computed for this curve. Check if the function is defined on the given domain.'
            };
        }

        if (!providedDomains.x) opts.xDomain = getBounds(finiteX, [-5, 5]);
        if (!providedDomains.y) opts.yDomain = getBounds(finiteY, [-5, 5]);
        if (!providedDomains.z) opts.zDomain = [-0.5, 0.5];

        try {
            latexText = `${semantics.lhs} = ${math.parse(semantics.rhs).toTex()}`;
        } catch (e) {
            latexText = `${semantics.lhs} = ${semantics.rhs}`;
        }

        return { success: true, type, plotData, latexText };
    }

    if (semantics.family === 'curve-implicit-2d') {
        type = 'curve';
        plotData = sampleImplicitPlaneCurve3d(
            semantics.lhs,
            semantics.rhs,
            semantics.coordVars,
            opts,
            semantics.polar
                ? (theta) => ({ [semantics.angleVar]: theta })
                : undefined
        );

        const finiteX = plotData.x.filter((value) => value !== null && isFinite(value));
        const finiteY = plotData.y.filter((value) => value !== null && isFinite(value));
        if (finiteX.length === 0) {
            return {
                success: false,
                error: 'No valid real numbers were computed for this curve. Check if the relation is defined on the given domains.'
            };
        }

        if (!providedDomains.x) opts.xDomain = getBounds(finiteX, [-5, 5]);
        if (!providedDomains.y) opts.yDomain = getBounds(finiteY, [-5, 5]);
        if (!providedDomains.z) opts.zDomain = [-0.5, 0.5];

        try {
            latexText = `${math.parse(semantics.lhs).toTex()} = ${math.parse(semantics.rhs).toTex()}`;
        } catch (e) {
            latexText = `${semantics.lhs} = ${semantics.rhs}`;
        }

        return { success: true, type, plotData, latexText };
    }

    if (semantics.family === 'surface-implicit') {
        const lhs = semantics.lhs;
        const rhs = semantics.rhs;
        const combined = `(${preprocessExpr(lhs)}) - (${preprocessExpr(rhs)})`;
        const projectedSurface = buildExplicitSurfaceFromLinearAxis(combined, opts, providedDomains);

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
        const xMin = opts.xDomain[0];
        const xMax = opts.xDomain[1];
        const yMin = opts.yDomain[0];
        const yMax = opts.yDomain[1];

        const zMin = (opts.zDomain && opts.zDomain[0] !== undefined) ? opts.zDomain[0] : xMin;
        const zMax = (opts.zDomain && opts.zDomain[1] !== undefined) ? opts.zDomain[1] : xMax;
        opts.zDomain = [zMin, zMax];

        const coarseSteps = opts.isEvolutionAnimated
            ? Math.max(12, Math.floor(DEFAULT_IMPLICIT_SURFACE_COARSE_STEPS / 2))
            : DEFAULT_IMPLICIT_SURFACE_COARSE_STEPS;
        const coarseXStep = (xMax - xMin) / coarseSteps;
        const coarseYStep = (yMax - yMin) / coarseSteps;
        const coarseZStep = (zMax - zMin) / coarseSteps;
        const coarseV = [];
        if (context.isSeparableImplicit && context.coarseLhsValues && context.rhsCompiled) {
            const rhsScope = mergeEvalScope(opts, {});
            const rhsValue = toReal(context.rhsCompiled.evaluate(rhsScope));
            for (let i = 0; i <= coarseSteps; i++) {
                const row = [];
                for (let j = 0; j <= coarseSteps; j++) {
                    const col = [];
                    for (let k = 0; k <= coarseSteps; k++) {
                        const lhsVal = context.coarseLhsValues[i][j][k];
                        col.push(isNaN(lhsVal) ? NaN : lhsVal - rhsValue);
                    }
                    row.push(col);
                }
                coarseV.push(row);
            }
        } else {
            const compiled = math.compile(combined);
            for (let i = 0; i <= coarseSteps; i++) {
                const x = xMin + i * coarseXStep;
                const row = [];
                for (let j = 0; j <= coarseSteps; j++) {
                    const y = yMin + j * coarseYStep;
                    const col = [];
                    for (let k = 0; k <= coarseSteps; k++) {
                        const z = zMin + k * coarseZStep;
                        if (shouldSkipCartesianPoint(opts, x, y, z)) {
                            col.push(NaN);
                            continue;
                        }

                        const val = evaluateImplicitSurfaceValue(
                            compiled,
                            coordSystem,
                            semantics.coordVars,
                            opts,
                            x,
                            y,
                            z
                        );
                        col.push(!isNaN(val) && isFinite(val) ? val : NaN);
                    }
                    row.push(col);
                }
                coarseV.push(row);
            }
        }

        const activeX = [];
        const activeY = [];
        const activeZ = [];

        for (let i = 0; i < coarseSteps; i++) {
            const cellXMin = xMin + i * coarseXStep;
            const cellXMax = cellXMin + coarseXStep;
            for (let j = 0; j < coarseSteps; j++) {
                const cellYMin = yMin + j * coarseYStep;
                const cellYMax = cellYMin + coarseYStep;
                for (let k = 0; k < coarseSteps; k++) {
                    const cellZMin = zMin + k * coarseZStep;
                    const cellZMax = cellZMin + coarseZStep;
                    const cellValues = [
                        coarseV[i][j][k],
                        coarseV[i + 1][j][k],
                        coarseV[i][j + 1][k],
                        coarseV[i + 1][j + 1][k],
                        coarseV[i][j][k + 1],
                        coarseV[i + 1][j][k + 1],
                        coarseV[i][j + 1][k + 1],
                        coarseV[i + 1][j + 1][k + 1]
                    ].filter((value) => !isNaN(value) && isFinite(value));

                    if (cellValues.length === 0) {
                        continue;
                    }

                    const minValue = Math.min(...cellValues);
                    const maxValue = Math.max(...cellValues);
                    if (minValue > 0 || maxValue < 0) {
                        continue;
                    }

                    activeX.push(cellXMin, cellXMax);
                    activeY.push(cellYMin, cellYMax);
                    activeZ.push(cellZMin, cellZMax);
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

            const padX = Math.max((rawMaxX - rawMinX) * DEFAULT_IMPLICIT_SURFACE_PADDING_RATIO, coarseXStep || 0.2);
            const padY = Math.max((rawMaxY - rawMinY) * DEFAULT_IMPLICIT_SURFACE_PADDING_RATIO, coarseYStep || 0.2);
            const padZ = Math.max((rawMaxZ - rawMinZ) * DEFAULT_IMPLICIT_SURFACE_PADDING_RATIO, coarseZStep || 0.2);

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

        // Feed Plotly a denser scalar field so implicit surfaces render with less faceting.
        const gridSteps = opts.isEvolutionAnimated
            ? Math.max(coarseSteps + 4, Math.floor(DEFAULT_IMPLICIT_SURFACE_GRID_STEPS / 2))
            : DEFAULT_IMPLICIT_SURFACE_GRID_STEPS;
        const evalXStep = (evalXMax - evalXMin) / gridSteps;
        const evalYStep = (evalYMax - evalYMin) / gridSteps;
        const evalZStep = (evalZMax - evalZMin) / gridSteps;
        const xVals = [];
        const yVals = [];
        const zVals = [];
        const valueVals = [];

        if (context.isSeparableImplicit && context.lhsCompiled && context.rhsCompiled) {
            const rhsScope = mergeEvalScope(opts, {});
            const rhsValue = toReal(context.rhsCompiled.evaluate(rhsScope));
            for (let i = 0; i <= gridSteps; i++) {
                const x = evalXMin + i * evalXStep;
                for (let j = 0; j <= gridSteps; j++) {
                    const y = evalYMin + j * evalYStep;
                    for (let k = 0; k <= gridSteps; k++) {
                        const z = evalZMin + k * evalZStep;
                        xVals.push(x);
                        yVals.push(y);
                        zVals.push(z);

                        if (shouldSkipCartesianPoint(opts, x, y, z)) {
                            valueVals.push(NaN);
                            continue;
                        }

                        try {
                            const lhsVal = evaluateImplicitSurfaceValue(
                                context.lhsCompiled,
                                coordSystem,
                                semantics.coordVars,
                                opts,
                                x,
                                y,
                                z
                            );
                            valueVals.push(!isNaN(lhsVal) && isFinite(lhsVal) ? lhsVal - rhsValue : NaN);
                        } catch (e) {
                            valueVals.push(NaN);
                        }
                    }
                }
            }
        } else {
            const compiled = math.compile(combined);
            for (let i = 0; i <= gridSteps; i++) {
                const x = evalXMin + i * evalXStep;
                for (let j = 0; j <= gridSteps; j++) {
                    const y = evalYMin + j * evalYStep;
                    for (let k = 0; k <= gridSteps; k++) {
                        const z = evalZMin + k * evalZStep;
                        xVals.push(x);
                        yVals.push(y);
                        zVals.push(z);

                        if (shouldSkipCartesianPoint(opts, x, y, z)) {
                            valueVals.push(NaN);
                            continue;
                        }

                        try {
                            const val = evaluateImplicitSurfaceValue(
                                compiled,
                                coordSystem,
                                semantics.coordVars,
                                opts,
                                x,
                                y,
                                z
                            );
                            valueVals.push(!isNaN(val) && isFinite(val) ? val : NaN);
                        } catch (e) {
                            valueVals.push(NaN);
                        }
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
    const lhs = semantics.lhs || 'z';
    const rhs = semantics.rhs;
    const [surfaceVarX, surfaceVarY] = semantics.surfaceVars || ['x', 'y'];
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
            if (isTracingLimited(opts, surfaceVarX, xValue) || isTracingLimited(opts, surfaceVarY, yValue)) {
                row.push(null);
                continue;
            }

            try {
                let zValue;
                if (coordSystem === 'cylindrical') {
                    const r = Math.sqrt(xValue*xValue + yValue*yValue);
                    const theta = Math.atan2(yValue, xValue);
                    zValue = toReal(compiled.evaluate(mergeEvalScope(opts, {
                        x: xValue,
                        y: yValue,
                        [surfaceVarX]: xValue,
                        [surfaceVarY]: yValue,
                        r,
                        theta
                    })));
                } else {
                    zValue = toReal(compiled.evaluate(mergeEvalScope(opts, {
                        x: xValue,
                        y: yValue,
                        [surfaceVarX]: xValue,
                        [surfaceVarY]: yValue
                    })));
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
        latexText = `${lhs} = ${math.parse(rhs).toTex()}`;
    } catch (e) {
        latexText = `${lhs} = ${rhs}`;
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
        const semantics = analyze3dPlot(expr, {
            kind: customOptions.kind,
            variables: customOptions.variables,
            labeledDomains: customOptions.labeledDomains
        });

        const evolutionRequested = Boolean(customOptions.isEvolutionAnimated);
        const cameraAnimationRequested = Boolean(customOptions.isCameraAnimated || (customOptions.isAnimated && !evolutionRequested));
        const traceVars = getPlot3dTraceVariables(semantics);

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
            semantics,
            hasEvolutionSweep
        });

        let aspectmode = customOptions.aspectmode;
        if (!aspectmode) {
            if (['surface-parametric', 'curve-parametric', 'surface-polar'].includes(semantics.family)) {
                aspectmode = 'manual';
            } else {
                aspectmode = 'cube';
            }
        }

        const coordSystem = semantics.coordSystem || 'cartesian';
        let defaultXLim = domainInfo.xDomain;
        let defaultYLim = domainInfo.yDomain;
        let defaultZLim = domainInfo.zDomain;

        if (coordSystem === 'cylindrical' || coordSystem === 'spherical') {
            const rMax = domainInfo.xDomain[1];
            defaultXLim = [-rMax, rMax];
            defaultYLim = [-rMax, rMax];
            if (coordSystem === 'spherical') {
                defaultZLim = [-rMax, rMax];
            }
        }

        const vectorDomainMask = semantics.family === 'vector'
            ? buildVectorDomainMask(semantics, customOptions.labeledDomains || {})
            : null;
        const vectorSeedBox = semantics.family === 'vector'
            ? resolveVectorSeedBox(domainInfo, customOptions, semantics, vectorDomainMask)
            : null;

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
            xLim: customOptions.xlim || undefined,
            yLim: customOptions.ylim || undefined,
            zLim: customOptions.zlim || undefined,
            isAnimated: cameraAnimationRequested || evolutionRequested,
            isCameraAnimated: cameraAnimationRequested,
            isEvolutionAnimated: evolutionRequested,
            evolutionVar,
            tracingVar: isTracingMode ? evolutionVar : null,
            animationMode: customOptions.animationMode || 'swing',
            animationAxis: customOptions.animationAxis || 'z',
            animationAngle: customOptions.animationAngle || null,
            camera: buildDefaultCamera(),
            aspectmode,
            evalScope: customOptions.evalScope,
            vectorDomainMask,
            streamlineSeeds: semantics.family === 'vector' && (customOptions.isFlux !== false)
                ? createDeterministicStreamlineSeeds(
                    vectorSeedBox.xDomain,
                    vectorSeedBox.yDomain,
                    vectorSeedBox.zDomain,
                    180,
                    'plot3d-vector-streamlines'
                )
                : undefined
        };

        const plotContext = {
            customOptions,
            expr,
            semantics,
            parameterDomain1: domainInfo.parameterDomain1,
            parameterDomain2: domainInfo.parameterDomain2,
            providedDomains: domainInfo.providedDomains,
            isSeparableImplicit: false,
            lhsCompiled: null,
            rhsCompiled: null,
            coarseLhsValues: null
        };

        const isSeparableImplicit = semantics.family === 'surface-implicit' &&
            evolutionRequested &&
            !expressionUsesAnySymbol(semantics.lhs, [evolutionVar]) &&
            !expressionUsesAnySymbol(semantics.rhs, semantics.coordVars);

        if (isSeparableImplicit) {
            try {
                plotContext.lhsCompiled = math.compile(preprocessExpr(semantics.lhs));
                plotContext.rhsCompiled = math.compile(preprocessExpr(semantics.rhs));
                
                const coarseSteps = baseOpts.isEvolutionAnimated
                    ? Math.max(12, Math.floor(DEFAULT_IMPLICIT_SURFACE_COARSE_STEPS / 2))
                    : DEFAULT_IMPLICIT_SURFACE_COARSE_STEPS;
                
                const xMin = domainInfo.xDomain[0];
                const xMax = domainInfo.xDomain[1];
                const yMin = domainInfo.yDomain[0];
                const yMax = domainInfo.yDomain[1];
                const zMin = (domainInfo.zDomain && domainInfo.zDomain[0] !== undefined) ? domainInfo.zDomain[0] : xMin;
                const zMax = (domainInfo.zDomain && domainInfo.zDomain[1] !== undefined) ? domainInfo.zDomain[1] : xMax;
                
                const coarseXStep = (xMax - xMin) / coarseSteps;
                const coarseYStep = (yMax - yMin) / coarseSteps;
                const coarseZStep = (zMax - zMin) / coarseSteps;

                const coarseLhsValues = [];
                for (let i = 0; i <= coarseSteps; i++) {
                    const x = xMin + i * coarseXStep;
                    const row = [];
                    for (let j = 0; j <= coarseSteps; j++) {
                        const y = yMin + j * coarseYStep;
                        const col = [];
                        for (let k = 0; k <= coarseSteps; k++) {
                            const z = zMin + k * coarseZStep;
                            if (shouldSkipCartesianPoint(baseOpts, x, y, z)) {
                                col.push(NaN);
                                continue;
                            }
                            const val = evaluateImplicitSurfaceValue(
                                plotContext.lhsCompiled,
                                coordSystem,
                                semantics.coordVars,
                                baseOpts,
                                x,
                                y,
                                z
                            );
                            col.push(!isNaN(val) && isFinite(val) ? val : NaN);
                        }
                        row.push(col);
                    }
                    coarseLhsValues.push(row);
                }
                
                plotContext.coarseLhsValues = coarseLhsValues;
                plotContext.isSeparableImplicit = true;
            } catch (err) {
                console.warn('Failed to precompute LHS grid for separable implicit surface:', err.message);
                plotContext.lhsCompiled = null;
                plotContext.rhsCompiled = null;
                plotContext.coarseLhsValues = null;
                plotContext.isSeparableImplicit = false;
            }
        }

        page = await katexModule.createRenderPage();

        if (evolutionRequested) {
            const totalFrames = DEFAULT_ANIMATION_FRAMES;
            const frameBuffers = [];
            const traceBounds = isTracingMode
                ? resolvePlot3dTraceBounds(evolutionVar, domainInfo)
                : null;
            const evolutionDomain = hasEvolutionSweep ? domainInfo.evolutionDomain : null;
            const domainsLocked = Boolean(domainInfo.providedDomains.x && domainInfo.providedDomains.y && domainInfo.providedDomains.z);
            const needsDomainPrepass = !domainsLocked;

            if (!needsDomainPrepass) {
                if (baseOpts.aspectmode === 'manual' && !baseOpts.aspectratio) {
                    baseOpts.aspectratio = buildAspectRatioFromDomains(baseOpts.xDomain, baseOpts.yDomain, baseOpts.zDomain);
                }

                let reusePlot = false;
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

                    const renderResult = await page.evaluate((lat, t, pData, opt, shouldReusePlot) => {
                        return window.renderGraph3d(lat, t, pData, opt, shouldReusePlot);
                    }, frameLatex, scene.type, scene.plotData, frameOpts, reusePlot);

                    if (!renderResult.success) {
                        return { success: false, error: renderResult.error };
                    }

                    if (cameraAnimationRequested) {
                        await page.evaluate((nextCamera) => {
                            return window.updateGraph3dCamera(nextCamera);
                        }, frameOpts.camera);
                    }

                    const card = await page.$('#card');
                    if (!card) {
                        return { success: false, error: 'Card element not found in DOM.' };
                    }

                    const buf = await card.screenshot({ type: 'jpeg', quality: 85 });
                    frameBuffers.push(buf);
                    reusePlot = true;
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

            const scenes = [];
            let globalXMin = Infinity, globalXMax = -Infinity;
            let globalYMin = Infinity, globalYMax = -Infinity;
            let globalZMin = Infinity, globalZMax = -Infinity;

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

                if (frameOpts.xDomain) {
                    globalXMin = Math.min(globalXMin, frameOpts.xDomain[0]);
                    globalXMax = Math.max(globalXMax, frameOpts.xDomain[1]);
                }
                if (frameOpts.yDomain) {
                    globalYMin = Math.min(globalYMin, frameOpts.yDomain[0]);
                    globalYMax = Math.max(globalYMax, frameOpts.yDomain[1]);
                }
                if (frameOpts.zDomain) {
                    globalZMin = Math.min(globalZMin, frameOpts.zDomain[0]);
                    globalZMax = Math.max(globalZMax, frameOpts.zDomain[1]);
                }

                scenes.push({ scene, frameOpts, evolutionValue });
            }

            const finalXDomain = (globalXMin < globalXMax) ? [globalXMin, globalXMax] : baseOpts.xDomain;
            const finalYDomain = (globalYMin < globalYMax) ? [globalYMin, globalYMax] : baseOpts.yDomain;
            const finalZDomain = (globalZMin < globalZMax) ? [globalZMin, globalZMax] : baseOpts.zDomain;

            let finalAspectRatio = baseOpts.aspectratio;
            if (baseOpts.aspectmode === 'manual' && !finalAspectRatio) {
                finalAspectRatio = buildAspectRatioFromDomains(finalXDomain, finalYDomain, finalZDomain);
            }

            let reusePlot = false;
            for (const item of scenes) {
                if (finalXDomain) item.frameOpts.xDomain = finalXDomain;
                if (finalYDomain) item.frameOpts.yDomain = finalYDomain;
                if (finalZDomain) item.frameOpts.zDomain = finalZDomain;
                if (finalAspectRatio) item.frameOpts.aspectratio = finalAspectRatio;

                const frameLatex = hasEvolutionSweep
                    ? appendEvolutionLatex(item.scene.latexText, evolutionVar, item.evolutionValue)
                    : item.scene.latexText;

                const renderResult = await page.evaluate((lat, t, pData, opt, shouldReusePlot) => {
                    return window.renderGraph3d(lat, t, pData, opt, shouldReusePlot);
                }, frameLatex, item.scene.type, item.scene.plotData, item.frameOpts, reusePlot);

                if (!renderResult.success) {
                    return { success: false, error: renderResult.error };
                }

                if (cameraAnimationRequested) {
                    await page.evaluate((nextCamera) => {
                        return window.updateGraph3dCamera(nextCamera);
                    }, item.frameOpts.camera);
                }

                const card = await page.$('#card');
                if (!card) {
                    return { success: false, error: 'Card element not found in DOM.' };
                }

                const buf = await card.screenshot({ type: 'jpeg', quality: 85 });
                frameBuffers.push(buf);
                reusePlot = true;
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

        if (opts.aspectmode === 'manual' && !opts.aspectratio) {
            opts.aspectratio = buildAspectRatioFromDomains(opts.xDomain, opts.yDomain, opts.zDomain);
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
    compileVideo,
    _internals: {
        buildExplicitSurfaceFromLinearAxis,
        buildPlot3dScene,
        buildVectorDomainMask,
        createDeterministicStreamlineSeeds,
        getPlot3dTraceVariables,
        pointPassesVectorDomainMask,
        resolveVectorSeedBox
    }
};
