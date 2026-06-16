const solver = require('./solver');

const testCases = [
    // Linear system
    'x + y = 5; x - y = 1',
    // Quadratic equation
    'x^2 - 5x + 6 = 0',
    // Quadratic equation with complex roots
    'x^2 + 1 = 0',
    // Cubic equation
    'x^3 - 6x^2 + 11x - 6 = 0',
    // Linear equation
    '3*x + 6 = 0',
    // Non-linear equation (transcendental)
    'cos(x) - x = 0',
    // Expression without "= 0"
    'x^2 - 4',
    // Tautology (no variables)
    '2 + 2 = 4',
    // Contradiction (no variables)
    '2 + 2 = 5',
    // Logarithms
    'ln(x) - 1 = 0',
    // Exponentials
    'exp(x) - 2 = 0',
    // Derivatives
    'deriv("x^3", "x", x) - 12 = 0', // derivative of x^3 is 3*x^2. 3*x^2 = 12 => x = 2 (or -2)
    // Integrals
    'integ("t^2", "t", 0, x) - 9 = 0' // integral of t^2 from 0 to x is x^3/3. x^3/3 = 9 => x = 3
];

console.log('=== RUNNING SOLVER TESTS ===\n');

testCases.forEach((test, idx) => {
    console.log(`Test ${idx + 1}: "${test}"`);
    const result = solver.solveEquation(test);
    if (result.success) {
        console.log('Success!');
        console.log(result.latex);
    } else {
        console.log('Failed:', result.error);
    }
    console.log('\n---------------------------------------\n');
});
