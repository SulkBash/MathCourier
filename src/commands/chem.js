const renderer = require('../renderer');

async function handleChemCommand(input) {
    return await renderer.renderChem(input);
}

module.exports = handleChemCommand;
