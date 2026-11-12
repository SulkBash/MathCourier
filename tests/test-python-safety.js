const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runSubprocess } = require('../src/solver/subprocess');

async function run() {
    console.log('--- STARTING PYTHON SOLVER SAFETY TESTS ---');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mathcourier-safety-'));
    const marker = path.join(directory, 'executed').replace(/\\/g, '/');
    const attack = `__import__('pathlib').Path(${JSON.stringify(marker)}).write_text('executed')`;
    const script = (name) => path.join(__dirname, '../python', name);
    const cases = [
        ['equation', 'equation_solver.py', { equations: [attack], mode: 'simplify' }],
        ['function string', 'equation_solver.py', { equations: [`sin(${JSON.stringify(attack)})`], mode: 'simplify' }],
        ['numeric constructor', 'equation_solver.py', { equations: [`Rational(${JSON.stringify(attack)})`], mode: 'simplify' }],
        ['symbol constructor', 'equation_solver.py', { equations: [`Symbol(${JSON.stringify(attack)})`], mode: 'simplify' }],
        ['nested helper', 'equation_solver.py', { equations: [`deriv(${JSON.stringify(attack)}, "x")`], mode: 'simplify' }],
        ['calculus', 'calculus_solver.py', { operation: 'diff', expr: attack, args: ['x'] }],
        ['scientific', 'scientific_solver.py', { operation: 'limit', args: [attack, 'x', '0'] }],
        ['ODE', 'ode_solver.py', { text: `dy/dx = ${attack}; y(0)=1`, mode: 'sym' }],
        ['PDE', 'pde_solver.py', { text: `du/dt = d2u/dx2; u(x,0)=${attack}; u(0,t)=0; u(pi,t)=0` }]
    ];

    try {
        for (const [label, name, payload] of cases) {
            const result = await runSubprocess(script(name), payload);
            assert.equal(result.success, false, `${label} must reject Python syntax`);
            assert.match(result.error, /unsupported|invalid|syntax|strings/i, `${label}: ${result.error}`);
            assert.equal(fs.existsSync(marker), false, `${label} executed the supplied code`);
            console.log(`PASS: ${label} rejects executable Python input`);
        }
    } finally {
        if (fs.existsSync(marker)) fs.unlinkSync(marker);
        fs.rmdirSync(directory);
    }
    console.log('--- PYTHON SOLVER SAFETY TESTS PASSED ---');
}

run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
