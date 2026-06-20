const renderer = require('../renderer');

async function handleTikzCommand(input) {
    return await renderer.renderTikz(input);
}

module.exports = handleTikzCommand;
