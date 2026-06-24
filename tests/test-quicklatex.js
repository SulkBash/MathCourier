const assert = require('assert');
const { parseQuickLaTeXResponse } = require('../src/renderer/quicklatex');

console.log('--- STARTING QUICKLATEX TESTS ---');

{
    const res = parseQuickLaTeXResponse([
        '0',
        'https://quicklatex.com/cache3/ab/valid.png 0 120 48'
    ].join('\n'));

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.imageUrl, 'https://quicklatex.com/cache3/ab/valid.png');
    assert.strictEqual(res.reportedWidth, 120);
    assert.strictEqual(res.reportedHeight, 48);
    console.log('PASS: Successful QuickLaTeX responses expose the image URL and size metadata');
}

{
    const res = parseQuickLaTeXResponse([
        '0',
        'https://quicklatex.com/cache3/d5/ql_bad.png 0 1 1'
    ].join('\n'));

    assert.strictEqual(res.success, false);
    assert(res.error.includes('empty 1x1 image'));
    console.log('PASS: Empty 1x1 QuickLaTeX images are rejected as compilation failures');
}

{
    const res = parseQuickLaTeXResponse([
        '-3',
        'https://quicklatex.com/cache3/error.png 0 0 0',
        'File ended while scanning use of \\CF_chemfigb.'
    ].join('\n'));

    assert.strictEqual(res.success, false);
    assert(res.error.includes('QuickLaTeX error'));
    assert(res.error.includes('File ended while scanning'));
    console.log('PASS: Error responses surface QuickLaTeX diagnostics');
}

console.log('--- QUICKLATEX TESTS PASSED ---');
