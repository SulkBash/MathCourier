const { parseCommandSyntax, normalizeAndValidate } = require('../src/parser');

let failedTests = 0;
let passedTests = 0;

function runTest(name, fn) {
    try {
        fn();
        console.log(`✓ ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`✗ ${name}`);
        console.error(err);
        failedTests++;
    }
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}

function assertDeepEqual(actual, expected, message) {
    const actStr = JSON.stringify(actual);
    const expStr = JSON.stringify(expected);
    if (actStr !== expStr) {
        throw new Error(`${message || 'Not equal'}\nExpected: ${expStr}\nActual:   ${actStr}`);
    }
}

console.log('=== RUNNING PARSER UNIT TESTS ===\n');

// ==================== PHASE 1 TESTS ====================

runTest('Basic scalar, range, and grouped parsing', () => {
    const input = 'x^3*y^2 vars:{x:2, y} dummy:val range:[1, 2]';
    const res = parseCommandSyntax(input);
    assert(res.success, 'Should succeed');
    assert(res.body === 'x^3*y^2', `Body mismatch: ${res.body}`);
    assertDeepEqual(res.options, {
        vars: 'x:2, y',
        dummy: 'val',
        range: ['1', '2']
    });
});

runTest('Nesting safety with parens, brackets, braces, and quotes', () => {
    const input = '(-y, x) kind:parametric t:[0, 2*pi] x:[-2, 2] y:[-2, 2]';
    const res = parseCommandSyntax(input);
    assert(res.success, 'Should succeed');
    assert(res.body === '(-y, x)', `Body mismatch: ${res.body}`);
    assertDeepEqual(res.options, {
        kind: 'parametric',
        t: ['0', '2*pi'],
        x: ['-2', '2'],
        y: ['-2', '2']
    });
});

runTest('Spec Example: !diff', () => {
    const input = 'x^3*y^2 vars:{x:2, y}';
    const res = parseCommandSyntax(input);
    assert(res.success, 'Should succeed');
    assert(res.body === 'x^3*y^2', `Body mismatch: ${res.body}`);
    assertDeepEqual(res.options, { vars: 'x:2, y' });
});

runTest('Detect duplicate options', () => {
    const input = 'sin(x) x:[-5, 5] x:[0, 1]';
    const res = parseCommandSyntax(input);
    assert(!res.success, 'Should fail');
    assert(res.errors.includes('Duplicate option: "x"'), 'Missing duplicate x error');
});

runTest('Detect unclosed range bracket', () => {
    const input = 'sin(x) x:[-5, 5';
    const res = parseCommandSyntax(input);
    assert(!res.success, 'Should fail');
    assert(res.errors.some(e => e.includes('unclosed range bracket')), 'Missing unclosed bracket error');
});

runTest('Detect range formatting error (too few/many parts)', () => {
    const input1 = 'sin(x) x:[5]';
    const res1 = parseCommandSyntax(input1);
    assert(!res1.success, 'Should fail for single element range');
    assert(res1.errors.some(e => e.includes('exactly two values')), 'Missing range format error');
});

runTest('Detect missing command body', () => {
    const res = parseCommandSyntax('x:[-5, 5] y:[0, 1]', { requireBody: true });
    assert(!res.success, 'Should fail when body is required and missing');
    assert(res.errors.includes('Missing command body.'), 'Missing empty body error');
});

runTest('Detect multiple candidate bodies', () => {
    const input = 'y = sin(x) x:[-5, 5] z = cos(x)';
    const res = parseCommandSyntax(input);
    assert(!res.success, 'Should fail for multiple candidate bodies');
    assert(res.errors.some(e => e.includes('Multiple candidate bodies detected')), 'Missing multiple bodies error');
});


// ==================== PHASE 2 TESTS ====================

runTest('Vars normalization: single and grouped', () => {
    // Single variable
    const p1 = parseCommandSyntax('sin(t) vars:t');
    const n1 = normalizeAndValidate(p1, 'diff');
    assert(n1.success, 'Normalization 1 should succeed');
    assertDeepEqual(n1.variables, [{ name: 't', order: 1 }]);

    // Grouped variables with orders
    const p2 = parseCommandSyntax('x^3*y^2 vars:{x:2, y}');
    const n2 = normalizeAndValidate(p2, 'diff');
    assert(n2.success, 'Normalization 2 should succeed');
    assertDeepEqual(n2.variables, [
        { name: 'x', order: 2 },
        { name: 'y', order: 1 }
    ]);
});

runTest('Vars validation rejects invalid or command-mismatched orders', () => {
    const invalidOrderParsed = parseCommandSyntax('x^2 vars:{x:0}');
    const invalidOrderNormalized = normalizeAndValidate(invalidOrderParsed, 'diff');
    assert(!invalidOrderNormalized.success, 'Should fail for zero-order derivative');
    assert(
        invalidOrderNormalized.errors.some(e => e.includes('positive integer')),
        'Missing positive integer validation error'
    );

    const intOrderParsed = parseCommandSyntax('x^2 vars:{x:2}');
    const intOrderNormalized = normalizeAndValidate(intOrderParsed, 'int');
    assert(!intOrderNormalized.success, 'Should fail for derivative-style order markers in !int');
    assert(
        intOrderNormalized.errors.some(e => e.includes('only supports order markers')),
        'Missing !diff-only order marker error'
    );
});

runTest('Ranges evaluation and normalization', () => {
    // Valid numbers and pi evaluation
    const p1 = parseCommandSyntax('sin(x) x:[-5, 5] t:[0, 2*pi]');
    const n1 = normalizeAndValidate(p1, 'plot');
    assert(n1.success, n1.errors.join(', '));
    assertDeepEqual(n1.ranges[0], { name: 'x', min: -5, max: 5, minExpr: '-5', maxExpr: '5' });
    
    // Check pi evaluation (approx 6.28318)
    const tRange = n1.ranges.find(r => r.name === 't');
    assert(tRange !== undefined, 't range should exist');
    assert(tRange.min === 0, 't range min should be 0');
    assert(Math.abs(tRange.max - 2 * Math.PI) < 1e-9, 't range max should be approx 2*pi');

    // Invalid range order (min >= max)
    const p2 = parseCommandSyntax('sin(x) x:[5, -5]');
    const n2 = normalizeAndValidate(p2, 'plot');
    assert(!n2.success, 'Should fail for min >= max');
    assert(n2.errors.some(e => e.includes('must be less than')), 'Missing min >= max error');

    // Non-numerical range expression
    const p3 = parseCommandSyntax('sin(x) x:[a, 5]');
    const n3 = normalizeAndValidate(p3, 'plot');
    assert(!n3.success, 'Should fail for symbol bounds');
    assert(n3.errors.some(e => e.includes('does not evaluate to a finite number')), 'Missing non-finite error');
});

runTest('View, Mode, and Kind enum validation', () => {
    // Valid enums
    const p1 = parseCommandSyntax('sin(x) view:3d mode:num kind:surface');
    const n1 = normalizeAndValidate(p1, 'plot');
    assert(n1.success, n1.errors.join(', '));
    assert(n1.options.view === '3d');
    assert(n1.options.mode === 'num');
    assert(n1.options.kind === 'surface');

    // Invalid view enum
    const p2 = parseCommandSyntax('sin(x) view:4d');
    const n2 = normalizeAndValidate(p2, 'plot');
    assert(!n2.success, 'Should fail for view:4d');
    assert(n2.errors.some(e => e.includes('Invalid view value')), 'Missing view validation error');

    // Invalid kind for plot 2D
    const p3 = parseCommandSyntax('sin(x) view:2d kind:surface');
    const n3 = normalizeAndValidate(p3, 'plot');
    assert(!n3.success, 'Should fail for kind:surface in 2D');
    assert(n3.errors.some(e => e.includes('Invalid kind')), 'Missing kind validation error');
});

runTest('Solve mode validation accepts symbolic and expression modes', () => {
    const validModes = ['factor', 'expand', 'simplify', 'sym', 'num', 'hybrid'];

    for (const mode of validModes) {
        const parsed = parseCommandSyntax(`x^2 - 5*x + 6 mode:${mode}`);
        const normalized = normalizeAndValidate(parsed, 'solve');
        assert(normalized.success, `Should accept solve mode:${mode}`);
        assert(normalized.options.mode === mode, `Expected solve mode ${mode}, got ${normalized.options.mode}`);
    }

    const invalidParsed = parseCommandSyntax('x^2 - 5*x + 6 mode:formula');
    const invalidNormalized = normalizeAndValidate(invalidParsed, 'solve');
    assert(!invalidNormalized.success, 'Should reject unsupported solve modes');
    assert(invalidNormalized.errors.some(e => e.includes('Invalid mode')), 'Missing invalid solve mode error');
});

runTest('Latex mode validation accepts rendering modes', () => {
    const validModes = ['formula', 'chem', 'tikz'];

    for (const mode of validModes) {
        const parsed = parseCommandSyntax(`x^2 + y^2 = 1 mode:${mode}`);
        const normalized = normalizeAndValidate(parsed, 'latex');
        assert(normalized.success, `Should accept latex mode:${mode}`);
        assert(normalized.options.mode === mode, `Expected latex mode ${mode}, got ${normalized.options.mode}`);
    }

    const invalidParsed = parseCommandSyntax('x^2 + y^2 = 1 mode:factor');
    const invalidNormalized = normalizeAndValidate(invalidParsed, 'latex');
    assert(!invalidNormalized.success, 'Should reject solve-only modes for latex');
    assert(invalidNormalized.errors.some(e => e.includes('Invalid mode')), 'Missing invalid latex mode error');
});

runTest('Camera and Animate structured option parsing', () => {
    // Valid camera and view:3d
    const p1 = parseCommandSyntax('z = x^2 view:3d camera:z360 animate:t');
    const n1 = normalizeAndValidate(p1, 'plot');
    assert(n1.success, n1.errors.join(', '));
    assertDeepEqual(n1.options.camera, { axis: 'z', angle: 360 });
    assert(n1.options.animate === 't');

    // Camera without angle
    const p2 = parseCommandSyntax('z = x^2 view:3d camera:y');
    const n2 = normalizeAndValidate(p2, 'plot');
    assert(n2.success, n2.errors.join(', '));
    assertDeepEqual(n1.options.camera, { axis: 'z', angle: 360 }); // check previous
    assertDeepEqual(n2.options.camera, { axis: 'y', angle: null });

    // Camera in view:2d error
    const p3 = parseCommandSyntax('z = x^2 view:2d camera:z360');
    const n3 = normalizeAndValidate(p3, 'plot');
    assert(!n3.success, 'Should fail for camera in 2D');
    assert(n3.errors.some(e => e.includes('only valid in 3D view')), 'Missing camera 2d restriction error');

    // Invalid camera axis format
    const p4 = parseCommandSyntax('z = x^2 view:3d camera:a360');
    const n4 = normalizeAndValidate(p4, 'plot');
    assert(!n4.success, 'Should fail for invalid camera format');
    assert(n4.errors.some(e => e.includes('Invalid camera format')), 'Missing format validation error');
});

runTest('Command-local rules', () => {
    // !ode requires ic option
    const p1 = parseCommandSyntax('dy/dx = -y x:[0, 5]');
    const n1 = normalizeAndValidate(p1, 'ode');
    assert(!n1.success, 'Should fail: ode requires ic');
    assert(n1.errors.some(e => e.includes('requires initial conditions')), 'Missing ode ic error');

    // !pde requires ic and bc options
    const p2 = parseCommandSyntax('du/dt = d2u/dx2 x:[0, pi]');
    const n2 = normalizeAndValidate(p2, 'pde');
    assert(!n2.success, 'Should fail: pde requires ic and bc');
    assert(n2.errors.some(e => e.includes('requires initial conditions')), 'Missing pde ic/bc error');
});

runTest('Phase option validation and normalization', () => {
    const validParsed = parseCommandSyntax('dx/dt = -y; dy/dt = x mode:num ic:{x(0)=1; y(0)=0} phase:{x, y}');
    const validNormalized = normalizeAndValidate(validParsed, 'ode');
    assert(validNormalized.success, validNormalized.errors.join(', '));
    assertDeepEqual(validNormalized.options.phase, ['x', 'y']);

    const duplicateParsed = parseCommandSyntax('dx/dt = -y; dy/dt = x mode:num ic:{x(0)=1; y(0)=0} phase:{x, x}');
    const duplicateNormalized = normalizeAndValidate(duplicateParsed, 'ode');
    assert(!duplicateNormalized.success, 'Should fail for duplicate phase axes');
    assert(duplicateNormalized.errors.some(e => e.includes('two distinct variables')), 'Missing distinct phase variables error');

    const malformedParsed = parseCommandSyntax('dx/dt = -y; dy/dt = x mode:num ic:{x(0)=1; y(0)=0} phase:{x, y, z}');
    const malformedNormalized = normalizeAndValidate(malformedParsed, 'ode');
    assert(!malformedNormalized.success, 'Should fail for three phase axes');
    assert(malformedNormalized.errors.some(e => e.includes('exactly two variables')), 'Missing phase arity error');
});

runTest('Display range options (xlim, ylim, zlim) validation and normalization', () => {
    const p1 = parseCommandSyntax('sin(x) x:[0, 5] xlim:[-10, 10] ylim:[-2, 2] zlim:[-5, 5]');
    const n1 = normalizeAndValidate(p1, 'plot');
    assert(n1.success, n1.errors.join(', '));
    assertDeepEqual(n1.options.xlim, [-10, 10]);
    assertDeepEqual(n1.options.ylim, [-2, 2]);
    assertDeepEqual(n1.options.zlim, [-5, 5]);

    // Invalid bounds order
    const p2 = parseCommandSyntax('sin(x) xlim:[10, -10]');
    const n2 = normalizeAndValidate(p2, 'plot');
    assert(!n2.success, 'Should fail when xlim min >= max');
    assert(n2.errors.some(e => e.includes('must be less than')), 'Missing min >= max error for xlim');

    // Non-numerical bounds
    const p3 = parseCommandSyntax('sin(x) xlim:[a, 10]');
    const n3 = normalizeAndValidate(p3, 'plot');
    assert(!n3.success, 'Should fail for non-finite bounds');
    assert(n3.errors.some(e => e.includes('does not evaluate to a finite number')), 'Missing non-finite error for xlim');
});

runTest('Dep option validation and normalization', () => {
    const p1 = parseCommandSyntax('x^2 + y^2 = 4 dep:y');
    const n1 = normalizeAndValidate(p1, 'diff');
    assert(n1.success, n1.errors.join(', '));
    assertDeepEqual(n1.options.dep, ['y']);

    const p2 = parseCommandSyntax('x^2 + y^2 + z^2 = 9 dep:{y, z}');
    const n2 = normalizeAndValidate(p2, 'diff');
    assert(n2.success, n2.errors.join(', '));
    assertDeepEqual(n2.options.dep, ['y', 'z']);

    const p3 = parseCommandSyntax('x^2 + y^2 = 4 dep:y:2');
    const n3 = normalizeAndValidate(p3, 'diff');
    assert(!n3.success, 'Should fail for invalid dependent variable syntax');
});

console.log(`\nTests finished: ${passedTests} passed, ${failedTests} failed.`);
if (failedTests > 0) {
    process.exit(1);
} else {
    console.log('ALL TESTS PASSED SUCCESSFULLY!\n');
}
