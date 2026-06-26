const assert = require('assert');

const { __testing } = require('../bot');
const botIdentity = require('../src/bot-identity');
const { createHarness } = require('./test-harness');

const { handleCommandMessage } = __testing;
const harness = createHarness('BOT ROUTING TESTS');

function createMessage(body, options = {}) {
    const calls = {
        getChat: 0,
        replies: []
    };

    return {
        calls,
        message: {
            author: options.author || null,
            body,
            from: options.from || 'user@example.com',
            fromMe: options.fromMe === true,
            async getChat() {
                calls.getChat += 1;
                return {
                    async sendStateTyping() {
                        throw new Error('Typing state should not be reached for ignored commands.');
                    }
                };
            },
            async reply(payload) {
                calls.replies.push(payload);
            }
        }
    };
}

async function runTests() {
    console.log('--- STARTING BOT ROUTING TESTS ---');
    botIdentity.__testing.resetState();
    botIdentity.__testing.setCachedProfile({ name: 'A' });

    await harness.runTest('Unknown bang commands are ignored without replying', async () => {
        const { message, calls } = createMessage('!ping');

        await handleCommandMessage(message);

        assert.equal(calls.replies.length, 0, 'expected no reply for unknown bang command');
        assert.equal(calls.getChat, 0, 'expected unknown bang command to stop before typing state');
    });

    await harness.runTest('Unknown bang commands do not fall back to inline $$ rendering', async () => {
        const { message, calls } = createMessage('!todo $$x^2 + y^2$$');

        await handleCommandMessage(message);

        assert.equal(calls.replies.length, 0, 'expected no reply for unknown bang command with $$ content');
        assert.equal(calls.getChat, 0, 'expected no render path for unknown bang command with $$ content');
    });

    await harness.runTest('Defined help command still replies normally', async () => {
        const { message, calls } = createMessage('@A !help');

        await handleCommandMessage(message);

        assert.equal(calls.replies.length, 1, 'expected one help reply');
        assert.equal(typeof calls.replies[0], 'string', 'expected help reply to be plain text');
        assert(calls.replies[0].includes('*MathCourier Help*'), 'expected general help text');
        assert.equal(calls.getChat, 0, 'expected help to bypass typing state and render pipeline');
    });

    await harness.runTest('Unaddressed math commands are ignored in shared chats', async () => {
        const { message, calls } = createMessage('!help');

        await handleCommandMessage(message);

        assert.equal(calls.replies.length, 0, 'expected no reply when the bot is not addressed');
        assert.equal(calls.getChat, 0, 'expected no render path when the bot is not addressed');
    });

    await harness.runTest('Messages addressed to a different bot name are ignored', async () => {
        const { message, calls } = createMessage('@B !help');

        await handleCommandMessage(message);

        assert.equal(calls.replies.length, 0, 'expected no reply for another bot name');
        assert.equal(calls.getChat, 0, 'expected no typing state for another bot name');
    });

    await harness.runTest('Owner can inspect bot naming with a bare admin command', async () => {
        const { message, calls } = createMessage('!botname', {
            from: 'owner@example.com',
            fromMe: true
        });

        await handleCommandMessage(message);

        assert.equal(calls.replies.length, 1, 'expected one admin reply');
        assert.equal(typeof calls.replies[0], 'string', 'expected admin reply to be plain text');
        assert(calls.replies[0].includes('*Bot Naming*'), 'expected bot naming help');
        assert.equal(calls.getChat, 0, 'expected botname admin command to bypass typing state');
    });

    harness.finish();
}

runTests().catch((err) => {
    console.error('Fatal error during bot routing tests:', err);
    process.exit(1);
});
