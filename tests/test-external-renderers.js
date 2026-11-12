const assert = require('assert');
const { EventEmitter } = require('events');
const https = require('https');
const { PassThrough } = require('stream');

const config = require('../config');
const { renderQuickLaTeX } = require('../src/renderer/quicklatex');
const { renderFallback } = require('../src/renderer/codecogs');

async function withResponses(responses, test) {
    const originalRequest = https.request;
    const requests = [];
    https.request = (options, callback) => {
        const plan = responses.shift();
        assert.ok(plan, 'unexpected external request');
        const request = new EventEmitter();
        request.destroy = () => { request.destroyed = true; };
        request.end = (body) => {
            requests.push({ options, body, request });
            if (plan.stall) return;
            process.nextTick(() => {
                const response = new PassThrough();
                response.statusCode = plan.status || 200;
                callback(response);
                if (plan.abort) response.emit('aborted');
                else response.end(plan.body || '');
            });
        };
        return request;
    };
    try {
        await test(requests);
        assert.equal(responses.length, 0, 'expected all planned requests');
    } finally {
        https.request = originalRequest;
    }
}

async function run() {
    console.log('--- STARTING EXTERNAL RENDERER TESTS ---');

    const formula = '\\chemfig{A+B & C%} + α';
    const preamble = '\\usepackage{chemfig}\n% A+B';
    const image = Buffer.from('image bytes');
    await withResponses([
        { body: '0\nhttps://quicklatex.com/cache/example.png 0 120 48\n' },
        { body: image }
    ], async (requests) => {
        const result = await renderQuickLaTeX(formula, preamble);
        assert.equal(result.success, true, result.error);
        assert.equal(result.data, image.toString('base64'));
        const form = new URLSearchParams(requests[0].body);
        assert.equal(form.get('formula'), formula);
        assert.equal(form.get('preamble'), preamble);
        assert.ok(requests[0].body.includes('\\chemfig{A%2BB'), 'TeX must stay verbatim while plus signs are escaped');
        assert.ok(requests[0].body.includes('\\usepackage{chemfig}\n'), 'preamble line breaks must stay verbatim');
        assert.equal(requests[0].options.headers['Content-Length'], Buffer.byteLength(requests[0].body));
    });
    console.log('PASS: QuickLaTeX preserves special characters in form fields');

    for (const imageUrl of [
        'http://quicklatex.com/image.png',
        'https://quicklatex.com.evil.example/image.png',
        'https://quicklatex.com:444/image.png',
        'https://user@quicklatex.com/image.png'
    ]) {
        await withResponses([{ body: `0\n${imageUrl} 0 10 10\n` }], async (requests) => {
            const result = await renderQuickLaTeX('x', '');
            assert.equal(result.success, false);
            assert.match(result.error, /unexpected host/i);
            assert.equal(requests.length, 1, 'must not fetch the returned URL');
        });
    }
    console.log('PASS: QuickLaTeX rejects unexpected image URLs');

    const previousTimeout = config.runtime.externalRendererTimeoutMs;
    const previousLimit = config.runtime.externalRendererMaxImageBytes;
    try {
        config.runtime.externalRendererTimeoutMs = 20;
        await withResponses([{ stall: true }], async (requests) => {
            const result = await renderFallback('x');
            assert.equal(result.success, false);
            assert.match(result.error, /timed out/i);
            assert.equal(requests[0].request.destroyed, true);
        });

        config.runtime.externalRendererMaxImageBytes = 4;
        await withResponses([{ body: 'too large' }], async () => {
            const result = await renderFallback('x');
            assert.equal(result.success, false);
            assert.match(result.error, /size limit/i);
        });

        await withResponses([{ abort: true }], async () => {
            const result = await renderFallback('x');
            assert.equal(result.success, false);
            assert.match(result.error, /interrupted/i);
        });
    } finally {
        config.runtime.externalRendererTimeoutMs = previousTimeout;
        config.runtime.externalRendererMaxImageBytes = previousLimit;
    }
    console.log('PASS: External requests handle timeouts, oversized and interrupted responses');
    console.log('--- EXTERNAL RENDERER TESTS PASSED ---');
}

run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
