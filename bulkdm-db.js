// ================================
// MASS DM DATABASE LAYER
// ================================
// Mass DM jobs are stored as a persistent queue so that, if the bot crashes
// or restarts, it resumes where it stopped (who was already messaged and
// who is still pending).

const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DB_PATH = path.join(__dirname, "bulkdm.db");
const db = new DatabaseSync(DB_PATH);

db.exec(`
    CREATE TABLE IF NOT EXISTS bulk_dm_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        admin_id TEXT NOT NULL,
        baslik TEXT,
        mesaj TEXT NOT NULL,
        link TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        created_at INTEGER NOT NULL,
        finished_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS bulk_dm_targets (
        job_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        updated_at INTEGER,
        PRIMARY KEY (job_id, user_id)
    );
`);

/**
 * Creates a mass DM job and stores its target user list.
 * @returns {number} jobId
 */
function createJob({ guildId, channelId, adminId, baslik, mesaj, link, targetUserIds }) {
    const result = db.prepare(`
        INSERT INTO bulk_dm_jobs (guild_id, channel_id, admin_id, baslik, mesaj, link, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'running', ?)
    `).run(guildId, channelId, adminId, baslik || null, mesaj, link || null, Date.now());

    const jobId = Number(result.lastInsertRowid);

    // All targets go in ONE transaction. Inserting them one by one (no
    // transaction) makes SQLite fsync for every row — ~11 seconds for 2500
    // targets, which blows past Discord's 3 second interaction window and
    // shows "didn't respond in time". In one transaction it takes milliseconds.
    const insertTarget = db.prepare(`
        INSERT OR IGNORE INTO bulk_dm_targets (job_id, user_id, status) VALUES (?, ?, 'pending')
    `);

    db.exec("BEGIN");
    try {
        for (const userId of targetUserIds) {
            insertTarget.run(jobId, userId);
        }
        db.exec("COMMIT");
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }

    return jobId;
}

function getRunningJobs() {
    return db.prepare("SELECT * FROM bulk_dm_jobs WHERE status = 'running'").all();
}

function getJob(jobId) {
    return db.prepare("SELECT * FROM bulk_dm_jobs WHERE id = ?").get(jobId);
}

function getPendingTargets(jobId) {
    return db.prepare(
        "SELECT user_id FROM bulk_dm_targets WHERE job_id = ? AND status = 'pending'"
    ).all(jobId);
}

function markTarget(jobId, userId, status) {
    db.prepare(`
        UPDATE bulk_dm_targets SET status = ?, updated_at = ? WHERE job_id = ? AND user_id = ?
    `).run(status, Date.now(), jobId, userId);
}

function getJobStats(jobId) {
    return db.prepare(`
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
        FROM bulk_dm_targets WHERE job_id = ?
    `).get(jobId);
}

function finishJob(jobId) {
    db.prepare("UPDATE bulk_dm_jobs SET status = 'done', finished_at = ? WHERE id = ?")
        .run(Date.now(), jobId);
}

module.exports = {
    createJob,
    getRunningJobs,
    getJob,
    getPendingTargets,
    markTarget,
    getJobStats,
    finishJob
};
