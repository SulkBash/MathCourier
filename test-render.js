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

    // Test Case 4: Chemical Structure (chemfig)
    const chemFormula = '\\chemfig{A-B*6(=-=-=-)}'; // Benzene derivative
    console.log(`\nTest Case 4: Rendering chemfig structure: ${chemFormula}`);
    try {
        const result4 = await renderer.renderChem(chemFormula);
        if (result4.success && result4.data) {
            const outputPath = path.join(outputDir, 'test_chemfig.png');
            fs.writeFileSync(outputPath, Buffer.from(result4.data, 'base64'));
            console.log(`✅ Success! Rendered using: [${result4.source}]`);
            console.log(`Saved output image to: ${outputPath}`);
        } else {
            console.error(`❌ Failed to render chemfig: ${result4.error}`);
        }
    } catch (err) {
        console.error(`❌ Unexpected error in Test 4:`, err.message);
    }

    // Test Case 5: TikZ Graphics
    const tikzFormula = `
\\draw[thick, fill=blue!10] (0,0) circle (1.5);
\\node[align=center] at (0,0) {TikZ\\\\Works!};
\\draw[->, red, very thick] (-2,2) -- (-0.2,0.2);
`;
    console.log(`\nTest Case 5: Rendering TikZ Graphics: ${tikzFormula.trim()}`);
    try {
        const result5 = await renderer.renderTikz(tikzFormula);
        if (result5.success && result5.data) {
            const outputPath = path.join(outputDir, 'test_tikz.png');
            fs.writeFileSync(outputPath, Buffer.from(result5.data, 'base64'));
            console.log(`✅ Success! Rendered using: [${result5.source}]`);
            console.log(`Saved output image to: ${outputPath}`);
        } else {
            console.error(`❌ Failed to render TikZ: ${result5.error}`);
        }
    } catch (err) {
        console.error(`❌ Unexpected error in Test 5:`, err.message);
    }

    // Test Case 6: Explicit function plotting
    const plotFormula1 = 'sin(x) * cos(x/2)';
    console.log(`\nTest Case 6: Rendering explicit plot: ${plotFormula1}`);
    try {
        const result6 = await renderer.renderPlot(plotFormula1, { xDomain: [-10, 10], yDomain: [-2, 2] });
        if (result6.success && result6.data) {
            const outputPath = path.join(outputDir, 'test_plot_explicit.png');
            fs.writeFileSync(outputPath, Buffer.from(result6.data, 'base64'));
            console.log(`✅ Success! Rendered using: [${result6.source}]`);
            console.log(`Saved output image to: ${outputPath}`);
        } else {
            console.error(`❌ Failed: ${result6.error}`);
        }
    } catch (err) {
        console.error(`❌ Unexpected error in Test 6:`, err.message);
    }

    // Test Case 7: Implicit equation plotting (Circle)
    const plotFormula2 = 'x^2 + y^2 = 1';
    console.log(`\nTest Case 7: Rendering implicit circle plot: ${plotFormula2}`);
    try {
        const result7 = await renderer.renderPlot(plotFormula2, { xDomain: [-1.5, 1.5], yDomain: [-1.5, 1.5] });
        if (result7.success && result7.data) {
            const outputPath = path.join(outputDir, 'test_plot_implicit_circle.png');
            fs.writeFileSync(outputPath, Buffer.from(result7.data, 'base64'));
            console.log(`✅ Success! Rendered using: [${result7.source}]`);
            console.log(`Saved output image to: ${outputPath}`);
        } else {
            console.error(`❌ Failed: ${result7.error}`);
        }
    } catch (err) {
        console.error(`❌ Unexpected error in Test 7:`, err.message);
    }

    // Test Case 8: Implicit equation plotting (Elliptic Curve)
    const plotFormula3 = 'y^2 = x^3 - x';
    console.log(`\nTest Case 8: Rendering implicit elliptic curve plot: ${plotFormula3}`);
    try {
        const result8 = await renderer.renderPlot(plotFormula3, { xDomain: [-2, 2], yDomain: [-2, 2] });
        if (result8.success && result8.data) {
            const outputPath = path.join(outputDir, 'test_plot_implicit_elliptic.png');
            fs.writeFileSync(outputPath, Buffer.from(result8.data, 'base64'));
            console.log(`✅ Success! Rendered using: [${result8.source}]`);
            console.log(`Saved output image to: ${outputPath}`);
        } else {
            console.error(`❌ Failed: ${result8.error}`);
        }
    } catch (err) {
        console.error(`❌ Unexpected error in Test 8:`, err.message);
    }

    // Test Case 9: Arctan equation plotting (User request)
    const plotFormulaArctan = 'arctan(x^3-x+y)=y^2';
    console.log(`\nTest Case 9: Rendering arctan equation plot: ${plotFormulaArctan}`);
    try {
        const resultArctan = await renderer.renderPlot(plotFormulaArctan, { xDomain: [-10, 10], yDomain: [-10, 10] });
        if (resultArctan.success && resultArctan.data) {
            const outputPath = path.join(outputDir, 'test_plot_arctan.png');
            fs.writeFileSync(outputPath, Buffer.from(resultArctan.data, 'base64'));
            console.log(`✅ Success! Rendered using: [${resultArctan.source}]`);
            console.log(`Saved output image to: ${outputPath}`);
        } else {
            console.error(`❌ Failed: ${resultArctan.error}`);
        }
    } catch (err) {
        console.error(`❌ Unexpected error in Test 9:`, err.message);
    }

    // Test Case 10: Plot error handling
    const plotFormula4 = 'y = sin(x /';
    console.log(`\nTest Case 10: Rendering invalid plot: ${plotFormula4}`);
    try {
        const result10 = await renderer.renderPlot(plotFormula4);
        if (!result10.success) {
            console.log(`✅ Success! Caught expected error: "${result10.error}"`);
        } else {
            console.error(`❌ Failed: Expected rendering to fail, but it succeeded.`);
        }
    } catch (err) {
        console.error(`❌ Unexpected error in Test 10:`, err.message);
    }

    // Test Case 11: Vector field plotting (user's exact expression)
    const plotFormulaVector = 'v(x,y)=(sin(x)/xy,cos(y)/xy)';
    console.log(`\nTest Case 11: Rendering vector field plot: ${plotFormulaVector}`);
    try {
        const resultVector = await renderer.renderPlot(plotFormulaVector, { xDomain: [-2, 2], yDomain: [-2, 2] });
        if (resultVector.success && resultVector.data) {
            const outputPath = path.join(outputDir, 'test_plot_vector.png');
            fs.writeFileSync(outputPath, Buffer.from(resultVector.data, 'base64'));
            console.log(`✅ Success! Rendered using: [${resultVector.source}]`);
            console.log(`Saved output image to: ${outputPath}`);
        } else {
            console.error(`❌ Failed: ${resultVector.error}`);
        }
    } catch (err) {
        console.error(`❌ Unexpected error in Test 11:`, err.message);
    }

    // Test Case 12: Natural Logarithm plotting (user's request)
    const plotFormulaLn = 'y = ln(x)';
    console.log(`\nTest Case 12: Rendering natural logarithm plot: ${plotFormulaLn}`);
    try {
        const resultLn = await renderer.renderPlot(plotFormulaLn, { xDomain: [-10, 10], yDomain: [-10, 10] });
        if (resultLn.success && resultLn.data) {
            const outputPath = path.join(outputDir, 'test_plot_ln.png');
            fs.writeFileSync(outputPath, Buffer.from(resultLn.data, 'base64'));
            console.log(`✅ Success! Rendered using: [${resultLn.source}]`);
            console.log(`Saved output image to: ${outputPath}`);
        } else {
            console.error(`❌ Failed: ${resultLn.error}`);
        }
    } catch (err) {
        console.error(`❌ Unexpected error in Test 12:`, err.message);
    }

    // Clean up
    console.log('\nShutting down renderer...');
    await renderer.close();
    console.log('--- TESTS COMPLETED ---');
}

runTests().catch(err => {
    console.error('Fatal error during test run:', err);
});
