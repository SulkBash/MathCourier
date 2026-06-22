const solver = require('../src/solver');
const renderer = require('../src/renderer');
const fs = require('fs');
const path = require('path');

const testCases = [
    { name: '1. Standard Equation (E = m * c^2 vars:c)', input: 'E = m * c^2 vars:c' },
    { name: '2. Gas Law (PV = nRT vars:T)', input: 'PV = nRT vars:T' },
    { name: '3. Quadratic (y = a*x^2 + b*x + c vars:x)', input: 'y = a*x^2 + b*x + c vars:x' },
    { name: '4. Trigonometry (sin(theta) = x / r vars:theta)', input: 'sin(theta) = x / r vars:theta' },
    { name: '5. Gravitation (F = G * m_1 * m_2 / r^2 vars:r)', input: 'F = G * m_1 * m_2 / r^2 vars:r' },
    { name: '6. Pythagorean (a^2 + b^2 = c^2 for a)', input: 'a^2 + b^2 = c^2 for a' }, // legacy fallback check
    { name: '7. Calculus Derivative (deriv("x^3", "x", x) = y vars:x)', input: 'deriv("x^3", "x", x) = y vars:x' },
    { name: '8. Calculus Integral (integ("t^2", "t", 0, x) = y vars:x)', input: 'integ("t^2", "t", 0, x) = y vars:x' },
    { name: '9. Error Case: Missing Target Variable', input: 'E = m * c^2' },
    { name: '10. Error Case: No Solution / Mismatch', input: 'sin(x) = y vars:z' }
];

async function runTests() {
    console.log('=== STARTING REARRANGE SOLVER INTEGRATION TESTS ===\n');
    
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
                const solveRes = await solver.rearrangeEquation(tc.input);
                if (!solveRes.success) {
                    console.log(`Solver Error (Expected for error cases): ${solveRes.error}`);
                    console.log('--------------------------------------------\n');
                    continue;
                }
                
                console.log(`Solver Success!`);
                console.log(`LaTeX Solution:\n${solveRes.latex}`);
                
                console.log(`Rendering formula card...`);
                const renderRes = await renderer.render(solveRes.latex, true);
                
                if (renderRes.success) {
                    const imgBuf = Buffer.from(renderRes.data, 'base64');
                    const imgPath = path.join(outputDir, `rearrange_test_${i + 1}.png`);
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
