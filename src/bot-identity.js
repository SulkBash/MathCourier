const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline/promises');

const {
    getBotIdentityPath,
    getConfiguredBotName,
    getWhatsAppClientId
} = require('./runtime');

const BOT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,23}$/;
const DEFAULT_SUGGESTION_LIMIT = 5;

let cachedProfile = null;
let botIdentityPathOverride = null;

function normalizeBotName(name = '') {
    return String(name || '').trim();
}

function normalizeBotNameKey(name = '') {
    return normalizeBotName(name).toLowerCase();
}

function validateBotName(name) {
    const normalized = normalizeBotName(name);
    if (!normalized) {
        return 'Bot name cannot be empty.';
    }

    if (normalized.length > 24) {
        return 'Bot name cannot be longer than 24 characters.';
    }

    if (!/^[A-Za-z]/.test(normalized)) {
        return 'Bot name must start with a letter.';
    }

    if (!BOT_NAME_PATTERN.test(normalized)) {
        return 'Bot name may only use letters, numbers, hyphens, and underscores.';
    }

    return null;
}

function buildBotProfile(name, source = 'stored') {
    const normalized = normalizeBotName(name);
    return {
        name: normalized,
        normalizedName: normalizeBotNameKey(normalized),
        address: `@${normalized}`,
        source
    };
}

function resolveBotIdentityPath() {
    return botIdentityPathOverride || getBotIdentityPath();
}

function ensureBotIdentityDirectory() {
    fs.mkdirSync(path.dirname(resolveBotIdentityPath()), { recursive: true });
}

function readStoredBotProfile() {
    const profilePath = resolveBotIdentityPath();
    if (!fs.existsSync(profilePath)) {
        return null;
    }

    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    } catch (err) {
        throw new Error(`Failed to read bot profile at "${profilePath}": ${err.message}`);
    }

    const validationError = validateBotName(parsed && parsed.name);
    if (validationError) {
        throw new Error(`Bot profile at "${profilePath}" is invalid: ${validationError}`);
    }

    return buildBotProfile(parsed.name, 'stored');
}

function getSeedBotName() {
    return normalizeBotName(getConfiguredBotName() || '');
}

function saveBotProfile(name, source = 'manual') {
    const normalized = normalizeBotName(name);
    const validationError = validateBotName(normalized);
    if (validationError) {
        throw new Error(validationError);
    }

    ensureBotIdentityDirectory();
    fs.writeFileSync(resolveBotIdentityPath(), `${JSON.stringify({
        name: normalized,
        updatedAt: new Date().toISOString()
    }, null, 2)}\n`);

    cachedProfile = buildBotProfile(normalized, source);
    return cachedProfile;
}

function getActiveBotProfile(options = {}) {
    if (!options.refresh && cachedProfile) {
        return cachedProfile;
    }

    const storedProfile = readStoredBotProfile();
    if (storedProfile) {
        cachedProfile = storedProfile;
        return cachedProfile;
    }

    const seededName = getSeedBotName();
    if (seededName) {
        cachedProfile = saveBotProfile(seededName, 'configured');
        return cachedProfile;
    }

    cachedProfile = null;
    return null;
}

function renameBot(name) {
    return saveBotProfile(name, 'command');
}

function escapeRegex(text) {
    return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractAddressedBody(body, botName) {
    const normalizedBody = String(body || '').trim();
    const normalizedName = normalizeBotName(botName);
    if (!normalizedBody || !normalizedName) {
        return null;
    }

    const pattern = new RegExp(`^@${escapeRegex(normalizedName)}(?=$|[\\s:,])(?:[:,])?\\s*([\\s\\S]*)$`, 'i');
    const match = normalizedBody.match(pattern);
    if (!match) {
        return null;
    }

    return {
        body: String(match[1] || '').trim(),
        address: `@${normalizedName}`
    };
}

function slugifyToken(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 12);
}

function getHostTag() {
    return (
        slugifyToken(process.env.USERNAME) ||
        slugifyToken(getWhatsAppClientId()) ||
        slugifyToken(os.hostname()) ||
        'host'
    );
}

function suggestBotNames(options = {}) {
    const limit = Math.max(1, Number(options.limit) || DEFAULT_SUGGESTION_LIMIT);
    const currentTag = slugifyToken(options.currentName || '');
    const hostTag = getHostTag();
    const sessionTag = slugifyToken(getWhatsAppClientId() || '');
    const suggestions = [];

    function pushCandidate(candidate) {
        const normalized = normalizeBotName(candidate);
        if (!normalized || suggestions.includes(normalized)) {
            return;
        }

        if (validateBotName(normalized)) {
            return;
        }

        suggestions.push(normalized);
    }

    if (currentTag) {
        pushCandidate(`${currentTag}-${hostTag}`);
    }

    for (const stem of ['calc', 'plot', 'solve', 'algebra', 'vector', 'graphs', 'math']) {
        pushCandidate(`${stem}-${hostTag}`);
    }

    if (sessionTag) {
        for (const stem of ['calc', 'plot', 'solve']) {
            pushCandidate(`${stem}-${sessionTag}`);
        }
    }

    return suggestions.slice(0, limit);
}

function getNamingGuidanceLines(options = {}) {
    const suggestions = suggestBotNames(options);

    return [
        '- Combine a math word with your nickname, initials, or device tag.',
        '- Avoid single-letter names in busy shared groups.',
        '- Use only letters, numbers, hyphens, and underscores.',
        '- Suggested handles:',
        ...suggestions.map((name) => `- \`${name}\``)
    ];
}

async function promptForBotName(options = {}) {
    const input = options.input || process.stdin;
    const output = options.output || process.stdout;
    const identityPath = resolveBotIdentityPath();

    if (!input.isTTY || !output.isTTY) {
        throw new Error(
            `Bot name is not configured. Start MathCourier in an interactive terminal once so it can save a bot name, or create "${identityPath}" with {"name":"YourBot"}.`
        );
    }

    const suggestions = suggestBotNames();
    output.write('\nMathCourier needs a bot name before it can reply in shared chats.\n');
    output.write('People will address this bot like `@your-bot-name !plot y = sin(x)`.\n');
    output.write('Choose a short name that is easy to type and unlikely to collide in your groups.\n');
    output.write(`Suggestions: ${suggestions.map((name) => `@${name}`).join(', ')}\n\n`);

    const rl = readline.createInterface({ input, output });

    try {
        while (true) {
            const answer = await rl.question('Bot name: ');
            const validationError = validateBotName(answer);
            if (validationError) {
                output.write(`${validationError}\n`);
                continue;
            }

            return saveBotProfile(answer, 'prompt');
        }
    } finally {
        rl.close();
    }
}

async function ensureBotProfile(options = {}) {
    const existingProfile = getActiveBotProfile({ refresh: options.refresh });
    if (existingProfile) {
        return existingProfile;
    }

    if (!options.interactive) {
        return null;
    }

    return promptForBotName(options);
}

function getBotAddress() {
    const profile = getActiveBotProfile();
    return profile ? profile.address : null;
}

module.exports = {
    ensureBotProfile,
    extractAddressedBody,
    getActiveBotProfile,
    getBotAddress,
    getNamingGuidanceLines,
    renameBot,
    suggestBotNames,
    validateBotName,
    __testing: {
        resetState() {
            cachedProfile = null;
            botIdentityPathOverride = null;
        },
        setCachedProfile(profile) {
            cachedProfile = profile ? buildBotProfile(profile.name || profile) : null;
        },
        setBotIdentityPathOverride(nextPath) {
            botIdentityPathOverride = nextPath || null;
        }
    }
};
