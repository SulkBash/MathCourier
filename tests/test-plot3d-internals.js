const assert = require('assert');
const plot3dModule = require('../src/renderer/plot3d');

console.log('=== RUNNING 3D INTERNALS TESTS ===');

{
    const traceVars = plot3dModule._internals.getPlot3dTraceVariables({
        family: 'vector',
        coordVars: ['r', 'theta', 'phi']
    });

    assert.deepStrictEqual(
        traceVars,
        [],
        'Vector-field animation variables should be treated as evolution sweeps, not trace variables.'
    );
    console.log('PASS: Vector fields do not consume animate:<coord> as a trace variable');
}

{
    const semantics = {
        family: 'vector',
        funcName: 'F',
        components: ['1/(r^2 + 0.1)', '0.25*sin(phi)', '0'],
        coordVars: ['r', 'theta', 'phi'],
        coordSystem: 'spherical'
    };

    const vectorDomainMask = plot3dModule._internals.buildVectorDomainMask(semantics, {
        r: [1, 5],
        theta: [0, Math.PI],
        phi: [0, 2 * Math.PI]
    });

    const streamlineSeeds = plot3dModule._internals.createDeterministicStreamlineSeeds(
        [-5, 5],
        [-5, 5],
        [-5, 5],
        24,
        'phi-sweep-test'
    );

    const context = {
        customOptions: { isFlux: true },
        expr: 'F(r, theta, phi) = (1/(r^2 + 0.1), 0.25*sin(phi), 0)',
        semantics,
        parameterDomain1: null,
        parameterDomain2: null,
        providedDomains: { x: true, y: true, z: true }
    };

    const baseOpts = {
        xDomain: [1, 5],
        yDomain: [0, Math.PI],
        zDomain: [0, 2 * Math.PI],
        xLim: [-5, 5],
        yLim: [-5, 5],
        zLim: [-5, 5],
        vectorDomainMask,
        streamlineSeeds
    };

    const sceneA = plot3dModule._internals.buildPlot3dScene(context, {
        ...baseOpts,
        evalScope: { phi: 0 }
    });
    const sceneB = plot3dModule._internals.buildPlot3dScene(context, {
        ...baseOpts,
        evalScope: { phi: Math.PI / 2 }
    });

    assert.strictEqual(sceneA.success, true);
    assert.strictEqual(sceneB.success, true);

    const conesDiffer = sceneA.plotData.coneU.some((value, index) =>
        Math.abs(value - sceneB.plotData.coneU[index]) > 1e-6
    ) || sceneA.plotData.coneV.some((value, index) =>
        Math.abs(value - sceneB.plotData.coneV[index]) > 1e-6
    ) || sceneA.plotData.coneW.some((value, index) =>
        Math.abs(value - sceneB.plotData.coneW[index]) > 1e-6
    );

    assert.strictEqual(
        conesDiffer,
        true,
        'Spherical vector scenes should change when phi is swept through evalScope.'
    );
    console.log('PASS: Spherical vector scenes change when phi evolves');
}

console.log('=== 3D INTERNALS TESTS PASSED ===');
