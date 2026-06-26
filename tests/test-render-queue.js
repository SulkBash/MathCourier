const assert = require('assert');

const { createJobQueue } = require('../src/renderer/jobQueue');
const { createHarness } = require('./test-harness');

const harness = createHarness('RENDER QUEUE TESTS');

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTests() {
    console.log('--- STARTING RENDER QUEUE TESTS ---');

    await harness.runTest('Queue accepts 50 simultaneous jobs while respecting worker limits', async () => {
        const queue = createJobQueue({
            concurrency: 5,
            maxQueue: 64,
            name: 'Test queue'
        });

        let active = 0;
        let peak = 0;
        let completed = 0;

        const jobs = Array.from({ length: 50 }, (_, index) => queue.run(async () => {
            active += 1;
            peak = Math.max(peak, active);
            await sleep(10);
            active -= 1;
            completed += 1;
            return index;
        }));

        const results = await Promise.all(jobs);
        assert.equal(results.length, 50, 'expected all 50 jobs to resolve');
        assert.equal(completed, 50, 'expected all 50 jobs to complete');
        assert.ok(peak <= 5, `expected peak concurrency <= 5, got ${peak}`);

        const stats = queue.getStats();
        assert.equal(stats.activeCount, 0, 'expected no active jobs after completion');
        assert.equal(stats.queuedCount, 0, 'expected no queued jobs after completion');
    });

    await harness.runTest('Queue rejects work after the configured backlog is full', async () => {
        const queue = createJobQueue({
            concurrency: 2,
            maxQueue: 3,
            name: 'Overflow queue'
        });

        const blockers = Array.from({ length: 5 }, () => queue.run(async () => {
            await sleep(25);
            return true;
        }));

        await assert.rejects(
            queue.run(async () => true),
            /saturated/i,
            'expected the sixth job to be rejected once the backlog is full'
        );

        await Promise.all(blockers);
    });

    harness.finish();
}

runTests().catch((err) => {
    console.error('Fatal error during render queue tests:', err);
    process.exit(1);
});
