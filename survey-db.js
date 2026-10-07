const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const db = new DatabaseSync(path.join(__dirname, "survey.db"));

db.exec(`
    CREATE TABLE IF NOT EXISTS surveys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT,
        question TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running', -- 'running' | 'ended'
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        ended_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS survey_options (
        survey_id INTEGER NOT NULL,
        idx INTEGER NOT NULL,
        label TEXT NOT NULL,
        PRIMARY KEY (survey_id, idx)
    );

    CREATE TABLE IF NOT EXISTS survey_votes (
        survey_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        option_idx INTEGER NOT NULL,
        voted_at INTEGER NOT NULL,
        PRIMARY KEY (survey_id, user_id)
    );
`);

function createSurvey({ guildId, channelId, question, createdBy, options }) {
    db.exec("BEGIN");
    try {
        const result = db.prepare(`
            INSERT INTO surveys (guild_id, channel_id, question, status, created_by, created_at)
            VALUES (?, ?, ?, 'running', ?, ?)
        `).run(guildId, channelId, question, createdBy, Date.now());
        const surveyId = Number(result.lastInsertRowid);

        const insertOption = db.prepare("INSERT INTO survey_options (survey_id, idx, label) VALUES (?, ?, ?)");
        options.forEach((label, idx) => insertOption.run(surveyId, idx, label));

        db.exec("COMMIT");
        return surveyId;
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}

function deleteSurvey(surveyId) {
    db.prepare("DELETE FROM survey_votes WHERE survey_id = ?").run(surveyId);
    db.prepare("DELETE FROM survey_options WHERE survey_id = ?").run(surveyId);
    db.prepare("DELETE FROM surveys WHERE id = ?").run(surveyId);
}

function setMessageId(surveyId, messageId) {
    db.prepare("UPDATE surveys SET message_id = ? WHERE id = ?").run(messageId, surveyId);
}

function getSurvey(surveyId) {
    return db.prepare("SELECT * FROM surveys WHERE id = ?").get(surveyId);
}

function getOptions(surveyId) {
    return db.prepare("SELECT idx, label FROM survey_options WHERE survey_id = ? ORDER BY idx").all(surveyId);
}

function getRunningSurveys(guildId) {
    return db.prepare(
        "SELECT * FROM surveys WHERE guild_id = ? AND status = 'running' ORDER BY id"
    ).all(guildId);
}

function markEnded(surveyId) {
    db.prepare("UPDATE surveys SET status = 'ended', ended_at = ? WHERE id = ?").run(Date.now(), surveyId);
}

/**
 * One vote per person. Clicking a different option moves the vote,
 * clicking the same option again withdraws it.
 * @returns {"voted"|"changed"|"removed"}
 */
function castVote(surveyId, userId, optionIdx) {
    const existing = db.prepare(
        "SELECT option_idx FROM survey_votes WHERE survey_id = ? AND user_id = ?"
    ).get(surveyId, userId);

    if (!existing) {
        db.prepare(
            "INSERT INTO survey_votes (survey_id, user_id, option_idx, voted_at) VALUES (?, ?, ?, ?)"
        ).run(surveyId, userId, optionIdx, Date.now());
        return "voted";
    }

    if (existing.option_idx === optionIdx) {
        db.prepare("DELETE FROM survey_votes WHERE survey_id = ? AND user_id = ?").run(surveyId, userId);
        return "removed";
    }

    db.prepare(
        "UPDATE survey_votes SET option_idx = ?, voted_at = ? WHERE survey_id = ? AND user_id = ?"
    ).run(optionIdx, Date.now(), surveyId, userId);
    return "changed";
}

function getVoteCounts(surveyId) {
    const rows = db.prepare(
        "SELECT option_idx, COUNT(*) AS votes FROM survey_votes WHERE survey_id = ? GROUP BY option_idx"
    ).all(surveyId);
    return new Map(rows.map(row => [row.option_idx, Number(row.votes)]));
}

module.exports = {
    createSurvey,
    deleteSurvey,
    setMessageId,
    getSurvey,
    getOptions,
    getRunningSurveys,
    markEnded,
    castVote,
    getVoteCounts
};
