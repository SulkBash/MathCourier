const { solveEquation } = require('./equations');
const { solveOde } = require('./ode');
const { rearrangeEquation } = require('./rearrange');
const { solveDerivative, solveIntegral } = require('./calculus');
const { solveGradient, solveLaplacian, solveDivergence, solveCurl } = require('./vector');
const { solveMatrixExpression } = require('./matrix');

module.exports = {
    solveEquation,
    solveOde,
    rearrangeEquation,
    solveDerivative,
    solveIntegral,
    solveMatrixExpression,
    solveGradient,
    solveLaplacian,
    solveDivergence,
    solveCurl
};
