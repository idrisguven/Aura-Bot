// ================================
// MASS DM LOGIC
// ================================
// The long-running send is completely independent from the Discord
// interaction lifetime: progress is written to SQLite, status reports are
// normal channel messages (a webhook token would expire after 15 minutes)
// and unfinished jobs automatically continue after a bot restart.

const { EmbedBuilder } = require("discord.js");
const db = require("./bulkdm-db.js");

const DELAY_MS = 800;
const PROGRESS_EVERY = 250;
const EMBED_COLOR = "#7B2FF7";

// Prevents two mass sends from running at the same time in one server.
const activeGuildIds = new Set();

function buildEmbed({ baslik, mesaj, link }, guildName) {
    const embed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setDescription(link ? `${mesaj}\n\n[🔗 Click here](${link})` : mesaj);

    if (baslik) embed.setTitle(baslik);
    if (guildName) embed.setFooter({ text: guildName });

    return embed;
}

async function report(client, job, content) {
    try {
        const channel = await client.channels.fetch(job.channel_id).catch(() => null);
        if (channel?.isTextBased()) {
            await channel.send({ content: `<@${job.admin_id}> ${content}` });
            return;
        }
    } catch {
        // channel deleted / not accessible, fall back to a DM below
    }

    try {
        const admin = await client.users.fetch(job.admin_id);
        await admin.send({ content });
    } catch {
        console.error(`Mass DM job #${job.id}: could not deliver the progress report.`);
    }
}

function isGuildBusy(guildId) {
    return activeGuildIds.has(guildId);
}

/**
 * Runs (or resumes) a job. Targets already marked "sent"/"failed" are never
 * retried — only "pending" ones are processed.
 */
async function runJob(client, jobId) {
    const job = db.getJob(jobId);
    if (!job || job.status !== "running") return;
    if (activeGuildIds.has(job.guild_id)) return;

    activeGuildIds.add(job.guild_id);

    try {
        const guild = client.guilds.cache.get(job.guild_id) || await client.guilds.fetch(job.guild_id).catch(() => null);
        if (!guild) {
            db.finishJob(jobId);
            return;
        }

        const embed = buildEmbed(job, guild.name);
        const targets = db.getPendingTargets(jobId);
        let processed = 0;

        for (const { user_id: userId } of targets) {
            try {
                const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
                if (!member) {
                    db.markTarget(jobId, userId, "failed");
                } else {
                    await member.send({ embeds: [embed] });
                    db.markTarget(jobId, userId, "sent");
                }
            } catch {
                db.markTarget(jobId, userId, "failed"); // DMs closed / blocked etc.
            }

            processed++;
            if (processed % PROGRESS_EVERY === 0) {
                const stats = db.getJobStats(jobId);
                await report(
                    client,
                    job,
                    `⏳ Mass DM in progress: **${stats.sent + stats.failed}/${stats.total}** processed (✅ ${stats.sent} · ❌ ${stats.failed}).`
                );
            }

            await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }

        db.finishJob(jobId);
        const finalStats = db.getJobStats(jobId);
        await report(
            client,
            job,
            `✅ Mass DM finished!\n📩 Delivered: **${finalStats.sent}**\n❌ Not delivered (DMs closed etc.): **${finalStats.failed}**`
        );
    } catch (error) {
        console.error(`Mass DM job #${jobId} error:`, error);
        await report(client, job, `❌ An unexpected error stopped the mass DM.\n\`\`\`${error.message || error}\`\`\``).catch(() => {});
    } finally {
        activeGuildIds.delete(job.guild_id);
    }
}

/**
 * On startup, continues jobs left unfinished by the previous run
 * (status='running'). Members already marked "sent" are not messaged again.
 */
async function resumeUnfinishedJobs(client) {
    for (const job of db.getRunningJobs()) {
        console.log(`Mass DM job #${job.id} was unfinished, resuming...`);
        runJob(client, job.id).catch(err => {
            console.error(`Mass DM job #${job.id} could not be resumed:`, err);
        });
    }
}

module.exports = {
    buildEmbed,
    runJob,
    resumeUnfinishedJobs,
    isGuildBusy,
    db
};
