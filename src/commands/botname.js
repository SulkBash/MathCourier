const {
    getActiveBotProfile,
    getNamingGuidanceLines,
    renameBot,
    validateBotName
} = require('../bot-identity');

const block = (lines) => lines.join('\n');

function formatOverview(profile) {
    const activeAddress = profile ? profile.address : '@your-bot-name';

    return block([
        '*Bot Naming*',
        '',
        `Current bot name: \`${activeAddress}\``,
        `Group usage: \`${activeAddress} !plot y = sin(x)\``,
        'Rename from your own WhatsApp account with `!botname set <new-name>`.',
        '',
        '*Suggestions To Avoid Duplicates*',
        ...getNamingGuidanceLines({ currentName: profile ? profile.name : '' })
    ]);
}

function formatSuggestions(profile) {
    return block([
        '*Bot Name Suggestions*',
        '',
        `Current bot name: \`${profile ? profile.address : '@your-bot-name'}\``,
        '',
        ...getNamingGuidanceLines({ currentName: profile ? profile.name : '' })
    ]);
}

function handleBotNameCommand(input = '') {
    const currentProfile = getActiveBotProfile();
    const trimmedInput = String(input || '').trim();

    if (!trimmedInput || /^help$/i.test(trimmedInput)) {
        return formatOverview(currentProfile);
    }

    if (/^(suggest|suggestions)$/i.test(trimmedInput)) {
        return formatSuggestions(currentProfile);
    }

    const [subcommand, ...rest] = trimmedInput.split(/\s+/);
    const normalizedSubcommand = subcommand.toLowerCase();
    const requestedName = ['set', 'rename', 'change'].includes(normalizedSubcommand)
        ? rest.join(' ').trim()
        : trimmedInput;

    if (!requestedName) {
        return block([
            '*MathCourier*',
            '',
            'Missing bot name.',
            'Try `!botname set calc-kevin`.'
        ]);
    }

    const validationError = validateBotName(requestedName);
    if (validationError) {
        return block([
            '*MathCourier*',
            '',
            `Bot name rejected: ${validationError}`,
            '',
            '*Suggestions To Avoid Duplicates*',
            ...getNamingGuidanceLines({ currentName: currentProfile ? currentProfile.name : '' })
        ]);
    }

    if (currentProfile && currentProfile.normalizedName === requestedName.toLowerCase()) {
        return formatOverview(currentProfile);
    }

    const updatedProfile = renameBot(requestedName);
    return block([
        '*Bot Name Updated*',
        '',
        `This bot now answers to \`${updatedProfile.address}\`.`,
        `Example: \`${updatedProfile.address} !solve x^2 - 4 = 0\``,
        '',
        '*Suggestions To Avoid Duplicates*',
        ...getNamingGuidanceLines({ currentName: updatedProfile.name })
    ]);
}

module.exports = handleBotNameCommand;
