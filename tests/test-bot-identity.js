const assert = require('assert');
const fs = require('fs');
const path = require('path');

const botIdentity = require('../src/bot-identity');
const handleBotNameCommand = require('../src/commands/botname');
const { createHarness } = require('./test-harness');

const harness = createHarness('BOT IDENTITY TESTS');
const tempProfilePath = path.join(__dirname, '../runtime_cache/test-bot-profile.json');

function resetState() {
    fs.mkdirSync(path.dirname(tempProfilePath), { recursive: true });
    if (fs.existsSync(tempProfilePath)) {
        fs.unlinkSync(tempProfilePath);
    }

    botIdentity.__testing.resetState();
    botIdentity.__testing.setBotIdentityPathOverride(tempProfilePath);
}

async function runTests() {
    console.log('--- STARTING BOT IDENTITY TESTS ---');

    await harness.runTest('Bot names validate and addressed prefixes strip cleanly', async () => {
        resetState();

        assert.equal(botIdentity.validateBotName('A'), null);
        assert.equal(botIdentity.validateBotName('calc-kevin'), null);
        assert(botIdentity.validateBotName('9calc').includes('start with a letter'));
        assert(botIdentity.validateBotName('bad name').includes('letters, numbers, hyphens, and underscores'));

        const matched = botIdentity.extractAddressedBody('@Calc-Kevin: !plot y = sin(x)', 'calc-kevin');
        assert.ok(matched, 'expected addressed prefix match');
        assert.equal(matched.body, '!plot y = sin(x)');
        assert.equal(botIdentity.extractAddressedBody('@calc-kevins !plot', 'calc-kevin'), null);
    });

    await harness.runTest('Suggestions stay valid and unique', async () => {
        resetState();

        const suggestions = botIdentity.suggestBotNames({ currentName: 'A', limit: 5 });
        assert.equal(suggestions.length, 5);
        assert.equal(new Set(suggestions).size, suggestions.length, 'expected unique suggestions');
        for (const suggestion of suggestions) {
            assert.equal(botIdentity.validateBotName(suggestion), null, `expected valid suggestion: ${suggestion}`);
        }
    });

    await harness.runTest('Bot name command can save and report the active bot name', async () => {
        resetState();

        const renameReply = handleBotNameCommand('set calc-kevin');
        assert(renameReply.includes('This bot now answers to `@calc-kevin`.'), 'expected rename confirmation');
        assert.ok(fs.existsSync(tempProfilePath), 'expected bot profile to be persisted');

        const storedProfile = JSON.parse(fs.readFileSync(tempProfilePath, 'utf8'));
        assert.equal(storedProfile.name, 'calc-kevin');

        const overviewReply = handleBotNameCommand('');
        assert(overviewReply.includes('Current bot name: `@calc-kevin`'), 'expected overview to include saved name');

        const suggestionsReply = handleBotNameCommand('suggestions');
        assert(suggestionsReply.includes('*Bot Name Suggestions*'), 'expected suggestions page');
        assert(suggestionsReply.includes('Avoid single-letter names in busy shared groups.'), 'expected duplicate guidance');
    });

    harness.finish();
}

runTests().catch((err) => {
    console.error('Fatal error during bot identity tests:', err);
    process.exit(1);
});
