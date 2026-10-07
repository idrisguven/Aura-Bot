const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const db = new DatabaseSync(path.join(__dirname, "welcome.db"));

db.exec(`
    CREATE TABLE IF NOT EXISTS welcome_settings (
        guild_id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS seen_members (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        first_seen_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id)
    );
`);

function setChannelId(guildId, channelId) {
    db.prepare(`
        INSERT INTO welcome_settings (guild_id, channel_id) VALUES (?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id
    `).run(guildId, channelId);
}

function getChannelId(guildId) {
    return db.prepare("SELECT channel_id FROM welcome_settings WHERE guild_id = ?").get(guildId)?.channel_id ?? null;
}

/**
 * Marks a member as seen. Returns true if they had NOT been seen before
 * (i.e. this is their first join), false if they were already known.
 */
function markSeen(guildId, userId) {
    const result = db.prepare(
        "INSERT OR IGNORE INTO seen_members (guild_id, user_id, first_seen_at) VALUES (?, ?, ?)"
    ).run(guildId, userId, Date.now());
    return Number(result.changes) > 0;
}

function markManySeen(guildId, userIds) {
    const insert = db.prepare(
        "INSERT OR IGNORE INTO seen_members (guild_id, user_id, first_seen_at) VALUES (?, ?, ?)"
    );
    const now = Date.now();

    db.exec("BEGIN");
    try {
        for (const userId of userIds) insert.run(guildId, userId, now);
        db.exec("COMMIT");
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}

module.exports = { setChannelId, getChannelId, markSeen, markManySeen };
