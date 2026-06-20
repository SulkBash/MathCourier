const solver = require('../solver');
const renderer = require('../renderer');

async function handleCurlCommand(input) {
    const curlRes = solver.solveCurl(input);
    if (!curlRes.success) {
        return { success: false, error: curlRes.error };
    }
    return await renderer.render(curlRes.latex, true);
}

module.exports = handleCurlCommand;
