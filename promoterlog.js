// ================================
// PROMOTER LOG
// ================================
// Watches the two promoter video/stream channels and reports which members
// with the Promoter role posted (and how much). Posts are recorded as they
// happen, so /promoterlog answers instantly and an automatic report goes to
// the log channel every 24 hours.

const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");
const db = require("./promoterlog-db.js");
const { ensureAllMembers } = require("./members.js");

const PROMOTER_ROLE_ID = "1558156067446194236";
const TRACKED_CHANNEL_IDS = new Set(["1558175428315844658", "1558175675473600512"]);
const REPORT_CHANNEL_ID = "1558179440708812811";

const DAY_MS = 24 * 60 * 60 * 1000;
const REPORT_INTERVAL_MS = DAY_MS;
const TICK_INTERVAL_MS = 5 * 60 * 1000;
const PAGE_BUTTON_PREFIX = "promoterlog_page_";
const PAGE_CHAR_BUDGET = 3900;
const EMBED_COLOR = "#9B59B6";

const command = new SlashCommandBuilder()
    .setName("promoterlog")
    .setDescription("Shows which promoters posted videos or streams recently.")
    .addIntegerOption(option =>
        option
            .setName("days")
            .setDescription("How far back to look (default: last 24 hours)")
            .addChoices(
                { name: "Last 24 hours", value: 1 },
                { name: "Last 7 days", value: 7 },
                { name: "Last 30 days", value: 30 }
            )
            .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON();

const backfillCommand = new SlashCommandBuilder()
    .setName("promoterlog-backfill")
    .setDescription("One-time scan of the promoter channels' history so older posts are counted.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON();

const activeBackfills = new Set();
const sendingReport = new Set();

function isAdmin(interaction) {
    return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

function isPromoter(member) {
    return member?.roles.cache.has(PROMOTER_ROLE_ID) ?? false;
}

function isTrackedChannel(channelId) {
    return TRACKED_CHANNEL_IDS.has(channelId);
}

function isPageButton(customId) {
    return customId.startsWith(PAGE_BUTTON_PREFIX);
}

/** Records a promoter's message in one of the tracked channels. Call for every new message. */
function handleMessage(message) {
    if (!message.guild || message.author?.bot || !isTrackedChannel(message.channel.id)) return;
    if (!isPromoter(message.member)) return;

    db.recordPost({
        guildId: message.guild.id,
        userId: message.author.id,
        channelId: message.channel.id,
        messageId: message.id,
        postedAt: message.createdTimestamp
    });
}

// ---------- the report ----------

function periodLabel(days) {
    return days === 1 ? "last 24 hours" : `last ${days} days`;
}

function jumpLink(guildId, post) {
    return `https://discord.com/channels/${guildId}/${post.channel_id}/${post.message_id}`;
}

function buildLines(guildId, promoters, stats, days) {
    const rows = promoters.map(member => ({ id: member.id, entry: stats.get(member.id) }));

    // 1) posted in the period (most posts first), 2) older posts only, 3) never.
    const group = row => (row.entry?.recent > 0 ? 0 : row.entry ? 1 : 2);
    rows.sort((a, b) =>
        group(a) - group(b)
        || (b.entry?.recent ?? 0) - (a.entry?.recent ?? 0)
        || Number(b.entry?.last.posted_at ?? 0) - Number(a.entry?.last.posted_at ?? 0)
    );

    return rows.map(({ id, entry }) => {
        if (!entry) return `❌ <@${id}> — never posted`;

        const last = `last <t:${Math.floor(Number(entry.last.posted_at) / 1000)}:R> ([jump](${jumpLink(guildId, entry.last)}))`;
        if (entry.recent === 0) return `💤 <@${id}> — none in the ${periodLabel(days)} · ${last}`;

        return `✅ <@${id}> — **${entry.recent}** post${entry.recent === 1 ? "" : "s"} · ${last}`;
    });
}

function paginate(lines) {
    const pages = [];
    let current = "";

    for (const line of lines) {
        const candidate = current ? `${current}\n${line}` : line;
        if (candidate.length > PAGE_CHAR_BUDGET) {
            pages.push(current);
            current = line;
        } else {
            current = candidate;
        }
    }
    if (current) pages.push(current);

    return pages;
}

/** All pages of the report for the given period, or [] when nobody has the Promoter role. */
async function buildPages(guild, days) {
    const members = await ensureAllMembers(guild);
    const promoters = [...members.values()].filter(member => isPromoter(member) && !member.user.bot);
    if (promoters.length === 0) return [];

    const stats = db.getStats(guild.id, Date.now() - days * DAY_MS);
    const lines = buildLines(guild.id, promoters, stats, days);
    const pages = paginate(lines);

    let postedCount = 0;
    let postTotal = 0;
    for (const member of promoters) {
        const recent = stats.get(member.id)?.recent ?? 0;
        if (recent > 0) postedCount++;
        postTotal += recent;
    }
    const footer = `${postedCount} of ${promoters.length} promoters posted · ${postTotal} post${postTotal === 1 ? "" : "s"} in the ${periodLabel(days)}`;

    return pages.map((description, index) =>
        new EmbedBuilder()
            .setColor(EMBED_COLOR)
            .setTitle(`🎥 Promoter Log — ${periodLabel(days)}${pages.length > 1 ? ` (Page ${index + 1}/${pages.length})` : ""}`)
            .setDescription(description)
            .setFooter({ text: footer })
            .setTimestamp()
    );
}

function buildPageButtons(days, pageIndex, totalPages) {
    if (totalPages <= 1) return null;

    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${PAGE_BUTTON_PREFIX}${days}_${pageIndex - 1}`)
            .setLabel("← Previous")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(pageIndex <= 0),
        new ButtonBuilder()
            .setCustomId(`${PAGE_BUTTON_PREFIX}${days}_${pageIndex + 1}`)
            .setLabel("Next →")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(pageIndex >= totalPages - 1)
    );
}

function firstPagePayload(pages, days) {
    const row = buildPageButtons(days, 0, pages.length);
    return { embeds: [pages[0]], components: row ? [row] : [] };
}

// ---------- commands ----------

async function handleCommand(interaction) {
    if (!isAdmin(interaction)) {
        return interaction.reply({ content: "❌ Only administrators can use this command.", flags: MessageFlags.Ephemeral });
    }

    const days = interaction.options.getInteger("days") ?? 1;

    // Deliberately public: the log channel is already staff only.
    await interaction.deferReply();

    try {
        const pages = await buildPages(interaction.guild, days);
        if (pages.length === 0) {
            return interaction.editReply({ content: "❌ Nobody has the Promoter role." });
        }
        return interaction.editReply(firstPagePayload(pages, days));
    } catch (error) {
        console.error("Failed to build the promoter log:", error);
        return interaction.editReply({ content: "❌ Something went wrong while building the promoter log." });
    }
}

async function handlePageButton(interaction) {
    if (!isAdmin(interaction)) {
        return interaction.reply({ content: "❌ Only administrators can use this.", flags: MessageFlags.Ephemeral });
    }

    const [days, requested] = interaction.customId.slice(PAGE_BUTTON_PREFIX.length).split("_").map(Number);
    await interaction.deferUpdate();

    try {
        const pages = await buildPages(interaction.guild, days);
        if (pages.length === 0) {
            return interaction.editReply({ content: "❌ Nobody has the Promoter role.", embeds: [], components: [] });
        }

        const page = Math.max(0, Math.min(requested, pages.length - 1));
        const row = buildPageButtons(days, page, pages.length);
        return interaction.editReply({ embeds: [pages[page]], components: row ? [row] : [] });
    } catch (error) {
        console.error("Failed to load a promoter log page:", error);
        return interaction.editReply({ content: "❌ Couldn't load that page.", embeds: [], components: [] });
    }
}

// ---------- history scan ----------

async function runBackfill(guild, onProgress) {
    await ensureAllMembers(guild);

    const channels = [...TRACKED_CHANNEL_IDS]
        .map(id => guild.channels.cache.get(id))
        .filter(Boolean);

    const result = { channelsTotal: channels.length, channelsScanned: 0, channelsSkipped: 0, messagesScanned: 0, postsRecorded: 0 };

    for (const channel of channels) {
        let before;

        while (true) {
            let batch;
            try {
                batch = await channel.messages.fetch(before ? { limit: 100, before } : { limit: 100 });
            } catch {
                result.channelsSkipped++;
                break;
            }
            if (batch.size === 0) break;

            for (const message of batch.values()) {
                result.messagesScanned++;
                if (message.author.bot || !isPromoter(guild.members.cache.get(message.author.id))) continue;

                db.recordPost({
                    guildId: guild.id,
                    userId: message.author.id,
                    channelId: channel.id,
                    messageId: message.id,
                    postedAt: message.createdTimestamp
                });
                result.postsRecorded++;
            }

            before = batch.last().id;
            if (batch.size < 100) break;
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        result.channelsScanned++;
        try {
            await onProgress({ ...result, currentChannel: channel.name, done: result.channelsScanned === channels.length });
        } catch {
            // a failed progress message must not stop the scan
        }
    }

    return result;
}

async function handleBackfillCommand(interaction) {
    if (!isAdmin(interaction)) {
        return interaction.reply({ content: "❌ Only administrators can use this command.", flags: MessageFlags.Ephemeral });
    }

    if (activeBackfills.has(interaction.guild.id)) {
        return interaction.reply({ content: "⏳ A scan is already running in this server.", flags: MessageFlags.Ephemeral });
    }

    await interaction.reply({
        content: "⏳ Scan started. Progress will be posted in this channel.",
        flags: MessageFlags.Ephemeral
    });

    const progressChannel = interaction.channel;
    activeBackfills.add(interaction.guild.id);

    runBackfill(interaction.guild, async progress => {
        await progressChannel.send(
            `${progress.done ? "✅ Scan finished!" : "⏳ Scanning..."}\n` +
            `📂 Channels: **${progress.channelsScanned}/${progress.channelsTotal}** (last: #${progress.currentChannel})\n` +
            `📨 Messages scanned: **${progress.messagesScanned}**\n` +
            `🎥 Promoter posts counted: **${progress.postsRecorded}**` +
            (progress.channelsSkipped > 0 ? `\n⚠️ Channels I couldn't read: **${progress.channelsSkipped}**` : "")
        );
    })
        .catch(error => {
            console.error("Promoter log backfill failed:", error);
            progressChannel.send(`❌ The scan failed: \`${error.message}\``).catch(() => {});
        })
        .finally(() => activeBackfills.delete(interaction.guild.id));
}

// ---------- daily report ----------

/**
 * Called every few minutes. Once 24 hours have passed since the last report,
 * posts a new one to the log channel. The very first call only starts the
 * clock (there is nothing meaningful to report before tracking began).
 */
async function tick(client) {
    const now = Date.now();

    for (const guild of client.guilds.cache.values()) {
        const channel = guild.channels.cache.get(REPORT_CHANNEL_ID);
        if (!channel || sendingReport.has(guild.id)) continue;

        const lastSent = db.getLastSentAt(guild.id);
        if (lastSent === null) {
            db.setLastSentAt(guild.id, now);
            continue;
        }
        if (now - lastSent < REPORT_INTERVAL_MS) continue;

        sendingReport.add(guild.id);
        try {
            const pages = await buildPages(guild, 1);
            if (pages.length > 0) {
                await channel.send(firstPagePayload(pages, 1));
            }
            db.setLastSentAt(guild.id, now);
        } catch (error) {
            console.error("Failed to send the daily promoter log:", error.message);
        } finally {
            sendingReport.delete(guild.id);
        }
    }
}

function start(client) {
    const run = () => tick(client).catch(error => console.error("Promoter log tick error:", error));
    setInterval(run, TICK_INTERVAL_MS);
    run();
}

module.exports = {
    commands: [command, backfillCommand],
    TRACKED_CHANNEL_IDS,
    isTrackedChannel,
    isPageButton,
    handleMessage,
    handleCommand,
    handleBackfillCommand,
    handlePageButton,
    tick,
    start
};
