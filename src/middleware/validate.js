const MAX_INPUT_LENGTH = 4000;

function validateInputLength(formula) {
    if (!formula || typeof formula !== 'string') return 'Empty or invalid formula.';
    if (formula.length > MAX_INPUT_LENGTH) {
        return `Input too long. Maximum allowed length is ${MAX_INPUT_LENGTH} characters.`;
    }
    return null;
}

module.exports = {
    validateInputLength
};
