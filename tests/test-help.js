const assert = require('assert');
const getHelp = require('../src/commands/help');

console.log('--- STARTING HELP TESTS ---');

const generalHelp = getHelp();
assert(generalHelp.includes('*MathCourier Help*'));
assert(generalHelp.includes('@your-bot-name'));
assert(generalHelp.includes('`!latex <content>`'));
assert(generalHelp.includes('`!plot <expression> [options]`'));
assert(generalHelp.includes('`!solve <expression> [options]`'));
assert(generalHelp.includes('`!botname [set <name>|suggestions]`'));
assert(generalHelp.includes('`!help [topic]`'));
assert(!generalHelp.includes('!chem <'));
assert(!generalHelp.includes('!tikz <'));
assert(!generalHelp.includes('!desp <'));
assert(!generalHelp.includes('!matrix <'));
console.log('PASS: General help advertises addressed commands and bot naming');

const plotHelp = getHelp('plot');
assert(plotHelp.includes('*2D And 3D Plotting*'));
assert(plotHelp.includes('kind:parametric'));
assert(plotHelp.includes('animate:t'));
assert(plotHelp.includes('draws the graph progressively'));
assert(plotHelp.includes('!plot y = sin(x) animate:x'));
assert(getHelp('!plot3d').includes('Command not found: !plot3d'));
console.log('PASS: Plot help documents only the unified !plot surface');

const latexHelp = getHelp('latex');
assert(latexHelp.includes('*Unified Latex Rendering*'));
assert(latexHelp.includes('mode:chem'));
assert(latexHelp.includes('mode:tikz'));
assert(latexHelp.includes('\\ce{CO2 + H2O <=> H2CO3}'));
assert(latexHelp.includes('KaTeX/mhchem'));
assert(latexHelp.includes('$$ ... $$'));
assert(getHelp('tex').includes('Command not found: !tex'));
assert(getHelp('chem').includes('Command not found: !chem'));
assert(getHelp('tikz').includes('Command not found: !tikz'));
console.log('PASS: Removed latex command aliases no longer resolve in help');

const botnameHelp = getHelp('botname');
assert(botnameHelp.includes('*botname - Bot Naming*'));
assert(botnameHelp.includes('!botname set calc-kevin'));
assert(botnameHelp.includes('@calc-kevin !plot y = sin(x)'));
assert(getHelp('rename').includes('*botname - Bot Naming*'));
console.log('PASS: Bot naming help documents addressing and rename flow');

const solveHelp = getHelp('solve');
assert(solveHelp.includes('*Unified Solve Command*'));
assert(solveHelp.includes('grad[x^2*y*z, vars:{x, y, z}]'));
assert(solveHelp.includes('det([1, 2; 3, 4])'));
assert(getHelp('matrix').includes('Command not found: !matrix'));
assert(getHelp('ode').includes('Command not found: !ode'));
console.log('PASS: Solve help documents helper-based syntax and no removed command aliases');

const helperHelp = getHelp('deriv');
assert(helperHelp.includes('*deriv Helper*'));
assert(helperHelp.includes('deriv[expr, x]'));
assert(helperHelp.includes('dep:y'));
assert(helperHelp.includes('at:{x:1, y:2}'));

const integHelp = getHelp('integ');
assert(integHelp.includes('*integ Helper*'));
assert(integHelp.includes('integ[expr, x:[0, pi]]'));
assert(!integHelp.includes('integ[expr, x, 0, pi]'));
assert(integHelp.includes('kind:line'));
assert(integHelp.includes('param:{...}'));

const helpersOverview = getHelp('helpers');
assert(helpersOverview.includes('*Inline Helpers*'));
assert(helpersOverview.includes('!help deriv'));
assert(helpersOverview.includes('!help integ'));
assert(helpersOverview.includes('!help curl'));
console.log('PASS: Helper docs now include dedicated deriv/integ pages and a richer overview');

const varsHelp = getHelp('vars');
assert(varsHelp.includes('*vars - Variable Specification*'));
assert(varsHelp.includes('!solve PV = nRT vars:T'));
assert(!varsHelp.includes('!desp'));

const syntaxHelp = getHelp('syntax');
assert(syntaxHelp.includes('@your-bot-name'));
assert(syntaxHelp.includes('!botname set calc-kevin'));

const modeHelp = getHelp('mode');
assert(modeHelp.includes('mode:simplify'));
assert(modeHelp.includes('mode:factor'));
assert(modeHelp.includes('mode:expand'));
assert(modeHelp.includes('mode:sym'));
assert(modeHelp.includes('mode:num'));
assert(modeHelp.includes('mode:hybrid'));
assert(!modeHelp.includes('mode:diff'));
assert(!modeHelp.includes('mode:grad'));
console.log('PASS: Option pages reflect the unified solve and latex modes');

const curlHelp = getHelp('curl');
assert(curlHelp.includes('*curl Helper*'));
assert(curlHelp.includes('curl[(Fx, Fy)]'));
assert(curlHelp.includes('scalar curl'));

const divHelp = getHelp('div');
assert(divHelp.includes('*div Helper*'));
assert(divHelp.includes('div[(Fx, Fy, Fz), vars:{x, y, z}]'));
console.log('PASS: Vector helper pages describe their argument shapes');

const animateHelp = getHelp('animate');
assert(animateHelp.includes('0` through `2*pi'));
assert(animateHelp.includes('graph is drawn progressively across that range'));
assert(animateHelp.includes('!plot y = sin(x - t) animate:t'));
assert(!animateHelp.includes('must also be provided'));
console.log('PASS: Animate help documents the default sweep range');

assert.strictEqual(getHelp.isHelpText(getHelp()), true);
assert.strictEqual(getHelp.isHelpText(getHelp('latex')), true);
assert.strictEqual(getHelp.isHelpText(getHelp('solve')), true);
assert.strictEqual(getHelp.isHelpText('!help solve'), false);
console.log('PASS: Help text detection works for general and detailed pages');

const invalidHelp = getHelp('!nonexistent');
assert(invalidHelp.includes('Command not found: !nonexistent'));
console.log('PASS: Invalid command fallback works');

console.log('--- HELP TESTS PASSED ---');
