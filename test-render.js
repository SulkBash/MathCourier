const fs = require('fs');
const path = require('path');
const renderer = require('./renderer');

async function runTests() {
    console.log('--- STARTING LATEX RENDER TESTS ---');
    
    // 1. Initialize renderer
    console.log('Initializing renderer...');
    await renderer.initialize();
    
    const isLocal = renderer.isLocalReady();
    console.log(`Renderer status: ${isLocal ? 'LOCAL (PUPPETEER) READY' : 'FALLBACK API MODE ONLY'}`);
    
    // Create test output directory if it doesn't exist
    const outputDir = path.join(__dirname, 'test_output');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir);
    }
    
    // Test Case 1: Simple block equation
    const formula1 = '\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}';
    console.log(`\nTest Case 1: Rendering equation: ${formula1}`);
    try {
        const result1 = await renderer.render(formula1, true);
        if (result1.success && result1.data) {
            const outputPath = path.join(outputDir, 'test_equation.png');
            fs.writeFileSync(outputPath, Buffer.from(result1.data, 'base64'));
            console.log(`✅ Success! Rendered using: [${result1.source}]`);
            console.log(`Saved output image to: ${outputPath}`);
        } else {
            console.error(`❌ Failed: ${result1.error}`);
        }
    } catch (err) {
        console.error(`❌ Unexpected error in Test 1:`, err.message);
    }

    // Test Case 2: Mixed text + equation
    const mixedText = 'Solving the quadratic equation:\nFor $a x^2 + b x + c = 0$, the roots are given by:\n$$\\displaystyle x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$';
    console.log(`\nTest Case 2: Rendering mixed text:\n"${mixedText}"`);
    try {
        const result2 = await renderer.render(mixedText, false);
        if (result2.success && result2.data) {
            const outputPath = path.join(outputDir, 'test_mixed.png');
            fs.writeFileSync(outputPath, Buffer.from(result2.data, 'base64'));
            console.log(`✅ Success! Rendered using: [${result2.source}]`);
            console.log(`Saved output image to: ${outputPath}`);
        } else {
            console.error(`❌ Failed: ${result2.error}`);
        }
    } catch (err) {
        console.error(`❌ Unexpected error in Test 2:`, err.message);
    }

    // Test Case 3: Error handling for invalid LaTeX
    const invalidFormula = '\\frac{a}{b'; // Missing closing bracket
    console.log(`\nTest Case 3: Rendering invalid equation (expecting error): ${invalidFormula}`);
    try {
        const result3 = await renderer.render(invalidFormula, true);
        if (!result3.success) {
            console.log(`✅ Success! Caught expected error: "${result3.error}"`);
        } else {
            console.error(`❌ Failed: Expected rendering to fail, but it succeeded.`);
        }
    } catch (err) {
        console.error(`❌ Unexpected error in Test 3:`, err.message);
    }

    // Clean up
    console.log('\nShutting down renderer...');
    await renderer.close();
    console.log('--- TESTS COMPLETED ---');
}

runTests().catch(err => {
    console.error('Fatal error during test run:', err);
});
