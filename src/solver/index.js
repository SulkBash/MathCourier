const { solveEquation } = require('./equations');
const { solveOde } = require('./ode');
const { solvePde } = require('./pde');
const { solveDerivative, solveIntegral } = require('./calculus');
const { solveGradient, solveLaplacian, solveDivergence, solveCurl } = require('./vector');
const { solveMatrixExpression } = require('./matrix');
const { solveScientific } = require('./scientific');
const { solveCurvilinear } = require('./curvilinear');

module.exports = {
    solveEquation,
    solveOde,
    solvePde,
    solveDerivative,
    solveIntegral,
    solveMatrixExpression,
    solveScientific,
    solveCurvilinear,
    solveGradient,
    solveLaplacian,
    solveDivergence,
    solveCurl
};
