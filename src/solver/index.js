const { solveEquation } = require('./equations');
const { solveOde } = require('./ode');
const { rearrangeEquation } = require('./rearrange');
const { solveDerivative, solveIntegral } = require('./calculus');

module.exports = {
    solveEquation,
    solveOde,
    rearrangeEquation,
    solveDerivative,
    solveIntegral
};
