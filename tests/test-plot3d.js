const assert = require('assert');
const config = require('../config');
const renderer = require('../src/renderer');
const handlePlotCommand = require('../src/commands/plot');
const plot3dModule = require('../src/renderer/plot3d');
const { createHarness } = require('./test-harness');

const harness = createHarness('3D PLOTTING TESTS');

async function runTests() {
    console.log('--- STARTING 3D PLOTTING TESTS ---');

    harness.runAssertion('3D Linear Implicit Surface Regression', () => {
        const surface = plot3dModule._internals.buildExplicitSurfaceFromLinearAxis('(y) - (x)', {
            xDomain: [-5, 10],
            yDomain: [-12, 13],
            zDomain: [0, 1]
        }, {
            x: true,
            y: true,
            z: true
        });

        assert.ok(surface, 'expected a direct surface mesh for y = x');
        assert.equal(surface.type, 'surface');
        assert.equal(surface.solvedAxis, 'y');
        assert.ok(Array.isArray(surface.plotData.x[0]), 'expected 2D x-grid data');
        assert.ok(Array.isArray(surface.plotData.y[0]), 'expected 2D y-grid data');
        assert.ok(Array.isArray(surface.plotData.z[0]), 'expected 2D z-grid data');

        let finitePoints = 0;
        for (let row = 0; row < surface.plotData.x.length; row++) {
            for (let col = 0; col < surface.plotData.x[row].length; col++) {
                const x = surface.plotData.x[row][col];
                const y = surface.plotData.y[row][col];
                const z = surface.plotData.z[row][col];
                if (x === null || y === null || z === null) {
                    continue;
                }

                finitePoints++;
                assert.ok(Math.abs(x - y) < 1e-9, `expected x and y to match, got x=${x}, y=${y}`);
                assert.ok(z >= 0 && z <= 1, `expected z to stay within the provided z-range, got z=${z}`);
            }
        }

        assert.ok(finitePoints > 0, 'expected at least one finite surface point');
    });

    harness.runAssertion('3D Streamline Seeds Are Deterministic', () => {
        const seedsA = plot3dModule._internals.createDeterministicStreamlineSeeds(
            [-2, 2],
            [-2, 2],
            [-2, 2],
            4,
            'comparison-box'
        );
        const seedsB = plot3dModule._internals.createDeterministicStreamlineSeeds(
            [-2, 2],
            [-2, 2],
            [-2, 2],
            4,
            'comparison-box'
        );

        assert.deepStrictEqual(seedsA, seedsB, 'expected identical seed clouds for the same comparison box');
    });

    harness.runAssertion('3D Implicit Surface Sampling Uses Dense Configured Grid', () => {
        const coarseSteps = Math.max(12, Number(config.bot?.plot3dImplicitCoarseSteps) || 36);
        const gridSteps = Math.max(coarseSteps + 4, Number(config.bot?.plot3dImplicitGridSteps) || 56);
        assert.ok(
            gridSteps > 35,
            `expected implicit surface sampling to stay above the legacy 35-step dense grid, got ${gridSteps}`
        );

        const scene = plot3dModule._internals.buildPlot3dScene({
            customOptions: {},
            expr: 'x^2 + y^2 + z^2 = 1',
            semantics: {
                family: 'surface-implicit',
                lhs: 'x^2 + y^2 + z^2',
                rhs: '1',
                coordVars: ['x', 'y', 'z'],
                coordSystem: 'cartesian'
            },
            parameterDomain1: null,
            parameterDomain2: null,
            providedDomains: { x: true, y: true, z: true }
        }, {
            xDomain: [-1.5, 1.5],
            yDomain: [-1.5, 1.5],
            zDomain: [-1.5, 1.5]
        });

        assert.equal(scene.success, true, scene.error || 'expected an implicit surface scene');
        assert.equal(scene.type, 'implicit');
        assert.equal(scene.plotData.value.length, Math.pow(gridSteps + 1, 3));
        assert.ok(
            scene.plotData.value.some((value) => Number.isFinite(value) && value < 0),
            'expected negative scalar values inside the implicit surface'
        );
        assert.ok(
            scene.plotData.value.some((value) => Number.isFinite(value) && value > 0),
            'expected positive scalar values outside the implicit surface'
        );
    });

    harness.runAssertion('3D Cartesian Vector Mask Supports Shared Spherical Radius Clip', () => {
        const semantics = {
            family: 'vector',
            coordSystem: 'cartesian',
            coordVars: ['x', 'y', 'z']
        };
        const mask = plot3dModule._internals.buildVectorDomainMask(semantics, {
            radius: [1, 3],
            x: [-2, 2],
            y: [-2, 2],
            z: [-2, 2]
        });

        assert.equal(
            plot3dModule._internals.pointPassesVectorDomainMask(0.5, 0, 0, mask),
            false,
            'expected the spherical radius clip to reject points inside the inner core'
        );
        assert.equal(
            plot3dModule._internals.pointPassesVectorDomainMask(1.5, 0, 0, mask),
            true,
            'expected the spherical radius clip to keep points in the shell'
        );
    });

    harness.runAssertion('3D Non-Cartesian Vector Fields Use Shared Cartesian Seed Boxes', () => {
        const seedBox = plot3dModule._internals.resolveVectorSeedBox(
            {
                xDomain: [1, 3],
                yDomain: [0, 2 * Math.PI],
                zDomain: [-2, 2]
            },
            {
                labeledDomains: {
                    x: [-2, 2],
                    y: [-2, 2],
                    z: [-2, 2]
                },
                xlim: [-4, 4],
                ylim: [-4, 4],
                zlim: [-4, 4]
            },
            {
                family: 'vector',
                coordSystem: 'cylindrical',
                coordVars: ['r', 'theta', 'z']
            },
            {
                cartesian: { x: [-2, 2], y: [-2, 2], z: [-2, 2] },
                cylindrical: { rho: [1, 3], theta: [0, 2 * Math.PI], z: [-2, 2] },
                spherical: null
            }
        );

        assert.deepStrictEqual(seedBox, {
            xDomain: [-2, 2],
            yDomain: [-2, 2],
            zDomain: [-2, 2]
        });
    });
    
    await renderer.initialize();
    console.log(`Renderer status: ${renderer.isLocalReady() ? 'local ready' : 'local not ready'}`);
    harness.ensureOutputDir();

    const mediaTests = [
        ['3D Static Surface Explicit', 'z = sin(x) * cos(y) view:3d x:[-3, 3] y:[-3, 3]'],
        ['3D Static Surface Integral', 'z = integ("cos(t)*y", "t:[0, x]") view:3d x:[-5, 5] y:[-5, 5]'],
        ['3D Static Parametric Curve', '(sin(t), cos(t), t) view:3d kind:curve vars:{t} t:[0, 6*pi]'],
        ['3D Delimited Parametric Curve', '(sin(t), cos(t), t/3) view:3d kind:curve vars:{t} camera:z animate:t t:[0, 6*pi] z:[-4, 4]'],
        ['3D Static Implicit Sphere', 'x^2 + y^2 + z^2 = 1 view:3d x:[-6, 6] y:[-6, 6] z:[-6, 6]'],
        ['3D Static Surface From Linear Z Equation', '4x^3 + 2yx + z = 0 view:3d x:[-10, 10] y:[-10, 10]'],
        ['3D Animated Implicit Sphere', 'x^2 + y^2 + z^2 = 1 view:3d camera:z x:[-6, 6] y:[-6, 6] z:[-6, 6]'],
        ['3D Animated Surface Explicit', 'z = sin(x) * cos(y) view:3d camera:z x:[-3, 3] y:[-3, 3]'],
        ['3D Animated Linear Y Surface', 'y = x view:3d x:[-5, 10] y:[-12, 13] z:[0, 1] camera:z80 animate:x'],
        ['3D Animated Full Orbit Sphere', 'x^2 + y^2 + z^2 = 1 view:3d camera:z360 x:[-6, 6] y:[-6, 6] z:[-6, 6]'],
        ['3D Animated Swing X Axis Sphere', 'x^2 + y^2 + z^2 = 1 view:3d camera:x x:[-6, 6] y:[-6, 6] z:[-6, 6]'],
        ['3D Animated Orbit Y Axis 180 Degrees Sphere', 'x^2 + y^2 + z^2 = 1 view:3d camera:y180 x:[-6, 6] y:[-6, 6] z:[-6, 6]'],
        ['3D Animated Orbit Z Axis 360 Degrees Sphere', 'x^2 + y^2 + z^2 = 1 view:3d camera:z360 x:[-6, 6] y:[-6, 6] z:[-6, 6]'],
        ['3D Evolution Surface Sweep', 'z = sin(x - t) * cos(y) view:3d animate:t x:[-3, 3] y:[-3, 3] t:[0, 2*pi] z:[-1.2, 1.2]'],
        ['3D Evolution Parametric Curve Trace', '(sin(t), cos(t), t/3) view:3d kind:curve vars:{t} animate:t t:[0, 6*pi]'],
        ['3D Combined Camera And Evolution Surface', 'z = sin(x - t) * cos(y) view:3d camera:z animate:t x:[-3, 3] y:[-3, 3] t:[0, 2*pi] z:[-1.2, 1.2]'],
        ['3D Static Vector Field Streamlines Default', 'F(x,y,z) = (-y, x, z/2) view:3d kind:vector vars:{x, y, z} x:[-4, 4] y:[-4, 4] z:[-4, 4]'],
        ['3D Animated Vector Field Streamlines Default', 'F(x,y,z) = (-y, x, z/2) view:3d kind:vector vars:{x, y, z} camera:z x:[-4, 4] y:[-4, 4] z:[-4, 4]'],
        ['3D Evolution Vector Field Streamlines Sweep', 'F(x,y,z) = (-y, x, a*z/2) view:3d kind:vector vars:{x, y, z} animate:a x:[-4, 4] y:[-4, 4] z:[-4, 4] a:[0, 2]'],
        ['3D Evolution Vector Field Spherical Sweep over Phi', 'F(r, theta, phi) = (1/(r^2 + 0.1), 0.25*sin(phi), 0) view:3d kind:vector vars:{r, theta, phi} animate:phi r:[1, 5] theta:[0, pi] phi:[0, 2*pi]']
    ];

    for (const [name, command] of mediaTests) {
        await harness.runTest(name, async () => {
            const result = await handlePlotCommand(command);
            harness.writeResult(name, harness.expectMediaSuccess(result));
        });
    }

    await harness.runTest('3D Parallel Animated Requests', async () => {
        const cases = [
            {
                name: 'surface',
                fn: () => handlePlotCommand('z = sin(x) * cos(y) view:3d camera:z x:[-3, 3] y:[-3, 3]')
            },
            {
                name: 'curve',
                fn: () => handlePlotCommand('(sin(t), cos(t), t) view:3d kind:curve vars:{t} camera:z t:[0, 6*pi]')
            }
        ];

        const results = await Promise.all(cases.map((testCase) => testCase.fn()));
        results.forEach((result, index) => {
            const label = `3D Parallel Animated Requests ${cases[index].name}`;
            harness.writeResult(label, harness.expectMediaSuccess(result));
        });
    });

    console.log('\nShutting down renderer...');
    await renderer.close();
    harness.finish();
}

runTests().catch(err => {
    console.error('Fatal error during test run:', err);
    process.exit(1);
});
