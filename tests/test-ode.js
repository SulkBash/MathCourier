const solver = require('../src/solver');
const renderer = require('../src/renderer');
const fs = require('fs');
const path = require('path');

const testCases = [
    // 1. Simple First-Order (Hybrid -> Symbolic)
    { name: '1. First-Order ODE (Symbolic)', input: 'dy/dx = -y ic:{y(0)=1} x:[-5, 5]' },
    
    // 2. Forced Symbolic (Symbolic-Only)
    { name: '2. Forced Symbolic ODE', input: 'dy/dx = x * y mode:sym ic:{y(0)=2} x:[-3, 3]' },
    
    // 3. Higher-Order ODE (Symbolic)
    { name: '3. Second-Order ODE (y\'\' + y = 0)', input: 'y\'\' + y = 0 ic:{y(0)=1; y\'(0)=0} x:[-10, 10]' },
    
    // 4. System of ODEs (Symbolic)
    { name: '4. System of ODEs (Circular)', input: 'dx/dt = -y; dy/dt = x ic:{x(0)=1; y(0)=0} t:[-6.28, 6.28]' },
    
    // 5. Numerical Fallback (No Analytical Solution)
    { name: '5. Numerical Fallback ODE (y\' = y^2 + x)', input: 'dy/dx = y^2 + x ic:{y(0)=1} x:[0, 1.2]' },
    
    // 6. Forced Numerical (Numerical-Only)
    { name: '6. Forced Numerical ODE', input: 'dy/dx = -y mode:num ic:{y(0)=1} x:[-5, 5]' },
    
    // 7. Error case: Missing Initial Condition
    { name: '7. Error Case (Missing IC)', input: 'dy/dx = -y' },
    
    // 8. Error case: Var mismatch
    { name: '8. Error Case (Variable Mismatch)', input: 'dy/dx = -y ic:{z(0)=1}' }
];

async function runTests() {
    console.log('=== STARTING ODE SOLVER INTEGRATION TESTS ===\n');
    
    // Ensure test_output folder exists
    const outputDir = path.join(__dirname, '../test_output');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    
    try {
        console.log('Bootstrapping LaTeX Renderer (Puppeteer)...');
        await renderer.initialize();
        console.log('Renderer ready.\n');
        
        for (let i = 0; i < testCases.length; i++) {
            const tc = testCases[i];
            console.log(`--- Test ${i + 1}: ${tc.name} ---`);
            console.log(`Input: "${tc.input}"`);
            
            try {
                const solveRes = await solver.solveOde(tc.input);
                if (!solveRes.success) {
                    console.log(`Solver Error (Expected for error cases): ${solveRes.error}`);
                    console.log('--------------------------------------------\n');
                    continue;
                }
                
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
                
                if (renderRes.success) {
                    const imgBuf = Buffer.from(renderRes.data, 'base64');
                    const imgPath = path.join(outputDir, `ode_test_${i + 1}.png`);
                    fs.writeFileSync(imgPath, imgBuf);
                    console.log(`Render Success! Image saved to: ${imgPath}`);
                } else {
                    console.log(`Render Failed: ${renderRes.error}`);
                }
                
            } catch (err) {
                console.error(`Unexpected Error during test:`, err);
            }
            console.log('--------------------------------------------\n');
        }
    } catch (err) {
        console.error('Failure in test runner setup:', err);
    } finally {
        console.log('Shutting down Renderer...');
        await renderer.close();
        console.log('Integration tests complete.');
    }
}

runTests();
