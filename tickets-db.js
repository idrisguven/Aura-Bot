const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const db = new DatabaseSync(path.join(__dirname, "tickets.db"));

db.exec(`
    CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        channel_id TEXT,
        user_id TEXT NOT NULL,
        category TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open', -- 'open' | 'closed'
        claimed_by TEXT,
        created_at INTEGER NOT NULL,
        closed_at INTEGER,
        closed_by TEXT,
        close_reason TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_channel ON tickets (channel_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_user_open ON tickets (guild_id, user_id, category, status);
`);

// The row is created BEFORE the channel (its id is used in the channel name),
// so a double click is already blocked while the channel is still being made.
function createTicket({ guildId, userId, category }) {
    const result = db.prepare(`
        INSERT INTO tickets (guild_id, user_id, category, status, created_at)
        VALUES (?, ?, ?, 'open', ?)
    `).run(guildId, userId, category, Date.now());
    return Number(result.lastInsertRowid);
}

function setChannelId(ticketId, channelId) {
    db.prepare("UPDATE tickets SET channel_id = ? WHERE id = ?").run(channelId, ticketId);
}

function deleteTicket(ticketId) {
    db.prepare("DELETE FROM tickets WHERE id = ?").run(ticketId);
}

function getTicket(ticketId) {
    return db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticketId);
}

function getTicketByChannel(channelId) {
    return db.prepare("SELECT * FROM tickets WHERE channel_id = ?").get(channelId);
}

function getOpenTicket(guildId, userId, category) {
    return db.prepare(
        "SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? AND category = ? AND status = 'open'"
    ).get(guildId, userId, category);
}

/** @returns {boolean} true if this call claimed it, false if someone already had. */
function claimTicket(ticketId, staffId) {
    const result = db.prepare(
        "UPDATE tickets SET claimed_by = ? WHERE id = ? AND claimed_by IS NULL AND status = 'open'"
    ).run(staffId, ticketId);
    return Number(result.changes) > 0;
}

function closeTicket(ticketId, closedBy, reason) {
    db.prepare(`
        UPDATE tickets SET status = 'closed', closed_at = ?, closed_by = ?, close_reason = ? WHERE id = ?
    `).run(Date.now(), closedBy, reason || null, ticketId);
}

module.exports = {
    createTicket,
    setChannelId,
    deleteTicket,
    getTicket,
    getTicketByChannel,
    getOpenTicket,
    claimTicket,
    closeTicket
};
