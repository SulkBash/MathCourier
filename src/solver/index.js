const { solveEquation } = require('./equations');
const { solveOde } = require('./ode');
const { solvePde } = require('./pde');
const { solveDerivative, solveIntegral } = require('./calculus');
const { solveGradient, solveLaplacian, solveDivergence, solveCurl } = require('./vector');
const { solveMatrixExpression } = require('./matrix');

module.exports = {
    solveEquation,
    solveOde,
    solvePde,
    solveDerivative,
    solveIntegral,
    solveMatrixExpression,
    solveGradient,
    solveLaplacian,
    solveDivergence,
    solveCurl
};
