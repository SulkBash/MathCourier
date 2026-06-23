const assert = require('assert');
const getHelp = require('../src/commands/help');

console.log('--- STARTING HELP TESTS ---');

// Test 1: General help
const genHelp = getHelp();
assert(genHelp.includes('*LaTeX Render Bot Help*'));
assert(genHelp.includes('Type `!command` followed by a space and the content you want to send.'));
assert(!genHelp.includes('!plot3d'));
assert(genHelp.includes('`view`'));
console.log('PASS: General help retrieves the new overview');

// Test 2: Specific help for !plot3d aliases to !plot
const plot3dHelp = getHelp('!plot3d');
assert(plot3dHelp.includes('*2D & 3D Plotting*'));
assert(plot3dHelp.includes('!plot <expression> [options]'));
assert(plot3dHelp.includes('animate:t'));
assert(plot3dHelp.includes('camera:z360'));
assert(!plot3dHelp.includes('!plot3d <expression> [options]'));
console.log('PASS: Specific help for !plot3d redirects to !plot guidance');

// Test 3: Specific help for plot3d (no exclamation)
const plot3dHelpNoExc = getHelp('plot3d');
assert(plot3dHelpNoExc.includes('*2D & 3D Plotting*'));
console.log('PASS: Specific help for plot3d works without the exclamation mark');

// Test 4: Case insensitivity
const plot3dHelpCaps = getHelp('PlOt3D');
assert(plot3dHelpCaps.includes('*2D & 3D Plotting*'));
console.log('PASS: Case insensitivity works');

// Test 5: Alias handling (tex -> latex)
const texHelp = getHelp('tex');
assert(texHelp.includes('*LaTeX Rendering*'));
assert(texHelp.includes('!latex <formula>'));
console.log('PASS: Alias resolution (tex -> latex) works');

// Test 6: Grouping (grad -> vector)
const gradHelp = getHelp('!grad');
assert(gradHelp.includes('*Vector Calculus*'));
assert(gradHelp.includes('!grad <scalar field>'));
console.log('PASS: Grouping resolution (grad -> vector) works');

// Test 7: Syntax alias
const rangesHelp = getHelp('ranges');
assert(rangesHelp.includes('*Syntax Basics*'));
assert(rangesHelp.includes('`!plot y = sin(x)`'));
assert(rangesHelp.includes('`!plot(y = sin(x))`'));
console.log('PASS: Syntax aliases resolve correctly');

// Test 8: Integration help mentions labeled field-integral ranges
const intHelp = getHelp('int');
assert(intHelp.includes('Omit `vars` to auto-detect when there is one variable'));
assert(intHelp.includes('x:[0, 1]'));
assert(intHelp.includes('!int x^2 + y vars:x'));
assert(intHelp.includes('scalar fields or vector fields'));
assert(intHelp.includes('!int x*y*z kind:volume x:[0, 1] y:[0, 2] z:[0, 3]'));
console.log('PASS: Integration help covers safer vars guidance and field-integral examples');

// Test 9: Inline helper help is discoverable
const helperHelp = getHelp('deriv');
assert(helperHelp.includes('*Inline Calculus Helpers*'));
assert(helperHelp.includes('deriv[x^3, x]'));
assert(helperHelp.includes('integ[x*y*z, kind:volume, x:[0, 1], y:[0, 2], z:[0, 3]]'));
console.log('PASS: Inline helper help is available through deriv/integ aliases');

// Test 10: Help text detection for bot self-messages
assert.strictEqual(getHelp.isHelpText(getHelp()), true);
assert.strictEqual(getHelp.isHelpText(getHelp('tikz')), true);
assert.strictEqual(getHelp.isHelpText(getHelp('helpers')), true);
assert.strictEqual(getHelp.isHelpText('!help plot'), false);
console.log('PASS: Help text detection works for general and detailed help');

// Test 11: Invalid command fallback
const invalidHelp = getHelp('!nonexistent');
assert(invalidHelp.includes('Command not found: !nonexistent'));
console.log('PASS: Invalid command fallback works');

console.log('--- HELP TESTS PASSED ---');
