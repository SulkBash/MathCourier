const solver = require('../src/solver');
const renderer = require('../src/renderer');
const { createHarness } = require('./test-harness');

const testCases = [
    // 1. Simple First-Order (Hybrid -> Symbolic)
    { name: '1. First-Order ODE (Symbolic)', input: 'dy/dx = -y ic:{y(0)=1} x:[-5, 5]', expectFailure: false },
    
    // 2. Forced Symbolic (Symbolic-Only)
    { name: '2. Forced Symbolic ODE', input: 'dy/dx = x * y mode:sym ic:{y(0)=2} x:[-3, 3]', expectFailure: false },
    
    // 3. Higher-Order ODE (Symbolic)
    { name: '3. Second-Order ODE (y\'\' + y = 0)', input: 'y\'\' + y = 0 ic:{y(0)=1; y\'(0)=0} x:[-10, 10]', expectFailure: false },
    
    // 4. System of ODEs (Symbolic)
    { name: '4. System of ODEs (Circular)', input: 'dx/dt = -y; dy/dt = x ic:{x(0)=1; y(0)=0} t:[-6.28, 6.28]', expectFailure: false },
    
    // 5. Numerical Fallback (No Analytical Solution)
    { name: '5. Numerical Fallback ODE (y\' = y^2 + x)', input: 'dy/dx = y^2 + x ic:{y(0)=1} x:[0, 1.2]', expectFailure: false },
    
    // 6. Forced Numerical (Numerical-Only)
    { name: '6. Forced Numerical ODE', input: 'dy/dx = -y mode:num ic:{y(0)=1} x:[-5, 5]', expectFailure: false },
    
    // 7. Error case: Missing Initial Condition
    { name: '7. Error Case (Missing IC)', input: 'dy/dx = -y', expectFailure: true },
    
    // 8. Error case: Var mismatch
    { name: '8. Error Case (Variable Mismatch)', input: 'dy/dx = -y ic:{z(0)=1}', expectFailure: true }
];

const harness = createHarness('ODE SOLVER INTEGRATION TESTS');

async function runTests() {
    console.log('=== STARTING ODE SOLVER INTEGRATION TESTS ===\n');
    harness.ensureOutputDir();
    
    try {
        console.log('Bootstrapping LaTeX Renderer (Puppeteer)...');
        await renderer.initialize();
        console.log('Renderer ready.\n');
        
        for (const tc of testCases) {
            await harness.runTest(tc.name, async () => {
                console.log(`Input: "${tc.input}"`);
                const solveRes = await solver.solveOde(tc.input);
                if (tc.expectFailure) {
                    harness.expectFailure(solveRes);
                    console.log('--------------------------------------------');
                    return;
                }
                
                harness.expectSuccess(solveRes, 'ODE solver failed unexpectedly.');
                console.log(`Solver Success!`);
                console.log(`Has Symbolic: ${solveRes.has_symbolic}`);
                console.log(`LaTeX Title: ${solveRes.has_symbolic ? solveRes.symbolic_latex : solveRes.ode_latex}`);
                
                // Determine Y domain
                let yDomain = solveRes.yDomain;
                if (!yDomain) {
                    let yValues = [];
                    Object.values(solveRes.curves).forEach(points => {
                        points.forEach(pt => {
                            if (pt.y !== null && !isNaN(pt.y) && isFinite(pt.y)) {
                                yValues.push(pt.y);
                            }
                        });
                    });
                    if (yValues.length > 0) {
                        const minVal = Math.min(...yValues);
                        const maxVal = Math.max(...yValues);
                        const range = maxVal - minVal;
                        const pad = Math.max(range * 0.15, 1.0);
                        yDomain = [minVal - pad, maxVal + pad];
                    } else {
                        yDomain = [-10, 10];
                    }
                }
                
                console.log(`Rendering plot card...`);
                const titleText = solveRes.has_symbolic ? solveRes.symbolic_latex : solveRes.ode_latex;
                const renderRes = await renderer.renderOde(titleText, solveRes.curves, {
                    xDomain: solveRes.xDomain,
                    yDomain: yDomain
                });
                
                harness.writeResult(tc.name, harness.expectMediaSuccess(renderRes));
                console.log('--------------------------------------------');
            });
        }
    } catch (err) {
        console.error('Failure in test runner setup:', err);
        process.exitCode = 1;
    } finally {
        console.log('Shutting down Renderer...');
        await renderer.close();
        harness.finish();
    }
}

runTests().catch((err) => {
    console.error('Fatal ODE integration test error:', err);
    process.exit(1);
});
