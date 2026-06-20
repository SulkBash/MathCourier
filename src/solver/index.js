const { solveEquation } = require('./equations');
const { solveOde } = require('./ode');
const { rearrangeEquation } = require('./rearrange');
const { solveDerivative, solveIntegral } = require('./calculus');
const { solveGradient, solveLaplacian, solveDivergence, solveCurl } = require('./vector');

module.exports = {
    solveEquation,
    solveOde,
    rearrangeEquation,
    solveDerivative,
    solveIntegral,
    solveGradient,
    solveLaplacian,
    solveDivergence,
    solveCurl
};
