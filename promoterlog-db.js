const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const db = new DatabaseSync(path.join(__dirname, "promoterlog.db"));

db.exec(`
    CREATE TABLE IF NOT EXISTS promoter_posts (
        message_id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        posted_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_promoter_posts_guild_time ON promoter_posts (guild_id, posted_at);

    CREATE TABLE IF NOT EXISTS promoter_report_state (
        guild_id TEXT PRIMARY KEY,
        last_sent_at INTEGER NOT NULL
    );
`);

// message_id is the primary key, so recording the same message twice (live
// tracking + backfill, or re-running the backfill) never double counts.
function recordPost({ guildId, userId, channelId, messageId, postedAt }) {
    db.prepare(`
        INSERT OR IGNORE INTO promoter_posts (message_id, guild_id, user_id, channel_id, posted_at)
        VALUES (?, ?, ?, ?, ?)
    `).run(messageId, guildId, userId, channelId, postedAt);
}

/**
 * Per promoter: how many posts since `sinceMs` and their most recent post
 * overall. @returns {Map<string, {recent: number, total: number, last: object}>}
 */
function getStats(guildId, sinceMs) {
    const rows = db.prepare(
        "SELECT user_id, channel_id, message_id, posted_at FROM promoter_posts WHERE guild_id = ? ORDER BY posted_at DESC"
    ).all(guildId);

    const stats = new Map();
    for (const row of rows) {
        let entry = stats.get(row.user_id);
        if (!entry) {
            entry = { recent: 0, total: 0, last: row };
            stats.set(row.user_id, entry);
        }
        entry.total++;
        if (Number(row.posted_at) >= sinceMs) entry.recent++;
    }
    return stats;
}

function getLastSentAt(guildId) {
    const row = db.prepare("SELECT last_sent_at FROM promoter_report_state WHERE guild_id = ?").get(guildId);
    return row ? Number(row.last_sent_at) : null;
}

function setLastSentAt(guildId, timestamp) {
    db.prepare(`
        INSERT INTO promoter_report_state (guild_id, last_sent_at) VALUES (?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET last_sent_at = excluded.last_sent_at
    `).run(guildId, timestamp);
}

module.exports = { recordPost, getStats, getLastSentAt, setLastSentAt };
