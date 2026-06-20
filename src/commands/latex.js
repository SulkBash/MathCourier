const renderer = require('../renderer');

async function handleLatexCommand(input) {
    return await renderer.render(input, true);
}

module.exports = handleLatexCommand;
