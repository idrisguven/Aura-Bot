// ================================
// SAFE "FETCH ALL MEMBERS" HELPER
// ================================
// guild.members.fetch() asks Discord for the whole member list through a
// gateway request (opcode 8) that is heavily rate limited. Several features
// need the list (startup bookkeeping, /welcome, /massdm), so they all go
// through here:
//   - once the list is loaded it stays up to date through join/leave events,
//     so there is no need to ask again;
//   - simultaneous callers share a single request;
//   - if Discord still says "retry after N seconds", we wait and try again.

const RECENT_FETCH_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 4;

const inFlight = new Map();
const lastFetchedAt = new Map();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithRetry(guild) {
    for (let attempt = 1; ; attempt++) {
        try {
            return await guild.members.fetch();
        } catch (error) {
            const retryAfter = error?.data?.retry_after;
            if (typeof retryAfter !== "number" || attempt >= MAX_ATTEMPTS) throw error;

            console.warn(`Member list request was rate limited, retrying in ${retryAfter}s (attempt ${attempt}/${MAX_ATTEMPTS}).`);
            await sleep((retryAfter + 1) * 1000);
        }
    }
}

/**
 * Returns the guild's member cache with every member loaded.
 * Only talks to Discord when the cache is incomplete.
 */
async function ensureAllMembers(guild) {
    const cache = guild.members.cache;

    if (cache.size >= guild.memberCount) return cache;
    if (Date.now() - (lastFetchedAt.get(guild.id) ?? 0) < RECENT_FETCH_MS) return cache;

    if (!inFlight.has(guild.id)) {
        const request = fetchWithRetry(guild)
            .then(() => {
                lastFetchedAt.set(guild.id, Date.now());
                return guild.members.cache;
            })
            .finally(() => inFlight.delete(guild.id));
        inFlight.set(guild.id, request);
    }

    return inFlight.get(guild.id);
}

module.exports = { ensureAllMembers };
