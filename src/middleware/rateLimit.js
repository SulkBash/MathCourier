const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;
const _rateLimitMap = new Map();

function isRateLimited(senderId) {
    const now = Date.now();
    let entry = _rateLimitMap.get(senderId);
    if (!entry || now - entry.windowStart >= RATE_WINDOW_MS) {
        entry = { count: 1, windowStart: now };
        _rateLimitMap.set(senderId, entry);
        return false;
    }
    entry.count++;
    return entry.count > MAX_REQUESTS_PER_WINDOW;
}

module.exports = {
    isRateLimited
};
