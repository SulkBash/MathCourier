function createJobQueue(options = {}) {
    const concurrency = Math.max(1, Number(options.concurrency) || 1);
    const maxQueue = Math.max(0, Number(options.maxQueue) || 0);
    const name = options.name || 'job queue';

    let activeCount = 0;
    const waitQueue = [];

    function getStats() {
        return {
            name,
            concurrency,
            maxQueue,
            activeCount,
            queuedCount: waitQueue.length
        };
    }

    function pumpQueue() {
        while (activeCount < concurrency && waitQueue.length > 0) {
            const job = waitQueue.shift();
            activeCount += 1;

            Promise.resolve()
                .then(job.run)
                .then(job.resolve, job.reject)
                .finally(() => {
                    activeCount = Math.max(0, activeCount - 1);
                    pumpQueue();
                });
        }
    }

    function run(task) {
        if (typeof task !== 'function') {
            return Promise.reject(new Error(`${name} expected a task function.`));
        }

        if (waitQueue.length >= maxQueue && activeCount >= concurrency) {
            return Promise.reject(new Error(`${name} is saturated. Please try again shortly.`));
        }

        return new Promise((resolve, reject) => {
            waitQueue.push({
                run: task,
                resolve,
                reject
            });
            pumpQueue();
        });
    }

    return {
        run,
        getStats
    };
}

module.exports = {
    createJobQueue
};
