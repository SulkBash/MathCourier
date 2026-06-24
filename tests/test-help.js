const assert = require('assert');
const getHelp = require('../src/commands/help');

console.log('--- STARTING HELP TESTS ---');

const generalHelp = getHelp();
assert(generalHelp.includes('*LaTeX Render Bot Help*'));
assert(generalHelp.includes('`!latex <content>`'));
assert(generalHelp.includes('`!plot <expression> [options]`'));
assert(generalHelp.includes('`!solve <expression> [options]`'));
assert(generalHelp.includes('`!help [topic]`'));
assert(!generalHelp.includes('!chem <'));
assert(!generalHelp.includes('!tikz <'));
assert(!generalHelp.includes('!desp <'));
assert(!generalHelp.includes('!matrix <'));
console.log('PASS: General help advertises only the unified public commands');

const plotAliasHelp = getHelp('!plot3d');
assert(plotAliasHelp.includes('*2D And 3D Plotting*'));
assert(plotAliasHelp.includes('kind:parametric'));
assert(plotAliasHelp.includes('animate:t'));
console.log('PASS: Plot aliases still resolve to the unified plot page');

const latexHelp = getHelp('tex');
assert(latexHelp.includes('*Unified Latex Rendering*'));
assert(latexHelp.includes('mode:chem'));
assert(latexHelp.includes('mode:tikz'));
assert(latexHelp.includes('$$ ... $$'));
assert(!latexHelp.includes('Legacy'));

const chemHelp = getHelp('chem');
assert(chemHelp.includes('*Unified Latex Rendering*'));
assert(chemHelp.includes('\\chemfig{H-O-H}'));

const tikzHelp = getHelp('tikz');
assert(tikzHelp.includes('*Unified Latex Rendering*'));
assert(tikzHelp.includes('\\begin{tikzpicture}'));
console.log('PASS: Latex, chem, and tikz aliases now share one page');

const solveHelp = getHelp('!grad');
assert(solveHelp.includes('*grad Helper*'));
assert(solveHelp.includes('grad("x^2*y*z", x, y, z)'));
assert(solveHelp.includes('1 to 3 coordinate symbols'));

const matrixHelp = getHelp('matrix');
assert(matrixHelp.includes('*Unified Solve Command*'));
assert(matrixHelp.includes('det([1, 2; 3, 4])'));
console.log('PASS: Solve aliases now resolve to the unified solve page');

const helperHelp = getHelp('deriv');
assert(helperHelp.includes('*deriv Helper*'));
assert(helperHelp.includes('deriv[expr, x]'));
assert(helperHelp.includes('dep:y'));
assert(helperHelp.includes('at:{x:1, y:2}'));
assert(!helperHelp.includes('Legacy'));

const integHelp = getHelp('integ');
assert(integHelp.includes('*integ Helper*'));
assert(integHelp.includes('integ[expr, x, 0, pi]'));
assert(integHelp.includes('kind:line'));
assert(integHelp.includes('param:{...}'));

const helpersOverview = getHelp('helpers');
assert(helpersOverview.includes('*Inline Helpers*'));
assert(helpersOverview.includes('!help deriv'));
assert(helpersOverview.includes('!help integ'));
assert(helpersOverview.includes('!help curl'));
assert(!helpersOverview.includes('Legacy'));
console.log('PASS: Helper docs now include dedicated deriv/integ pages and a richer overview');

const varsHelp = getHelp('vars');
assert(varsHelp.includes('*vars - Variable Specification*'));
assert(varsHelp.includes('!solve PV = nRT vars:T'));
assert(!varsHelp.includes('!desp'));

const modeHelp = getHelp('mode');
assert(modeHelp.includes('mode:simplify'));
assert(modeHelp.includes('mode:factor'));
assert(modeHelp.includes('mode:expand'));
assert(modeHelp.includes('mode:sym'));
assert(modeHelp.includes('mode:num'));
assert(modeHelp.includes('mode:hybrid'));
console.log('PASS: Option pages reflect the unified solve and latex modes');

const curlHelp = getHelp('curl');
assert(curlHelp.includes('*curl Helper*'));
assert(curlHelp.includes('curl("(Fx, Fy)", x, y)'));
assert(curlHelp.includes('scalar curl'));

const divHelp = getHelp('div');
assert(divHelp.includes('*div Helper*'));
assert(divHelp.includes('div("(Fx, Fy, Fz)", x, y, z)'));
console.log('PASS: Vector helper pages describe their argument shapes');

assert.strictEqual(getHelp.isHelpText(getHelp()), true);
assert.strictEqual(getHelp.isHelpText(getHelp('latex')), true);
assert.strictEqual(getHelp.isHelpText(getHelp('solve')), true);
assert.strictEqual(getHelp.isHelpText('!help solve'), false);
console.log('PASS: Help text detection works for general and detailed pages');

const invalidHelp = getHelp('!nonexistent');
assert(invalidHelp.includes('Command not found: !nonexistent'));
console.log('PASS: Invalid command fallback works');

console.log('--- HELP TESTS PASSED ---');
