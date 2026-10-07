const MAX_MESSAGES = 5000;

/**
 * Reads the channel's messages (up to MAX_MESSAGES, newest first while
 * paging) and returns them oldest -> newest.
 */
async function fetchAllMessages(channel) {
    const all = [];
    let before;

    while (all.length < MAX_MESSAGES) {
        const batch = await channel.messages.fetch(before ? { limit: 100, before } : { limit: 100 });
        if (batch.size === 0) break;

        all.push(...batch.values());
        before = batch.last().id;
        if (batch.size < 100) break;
    }

    return all.reverse();
}

function formatTime(timestamp) {
    return new Date(timestamp).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function formatUser(user) {
    if (!user) return "unknown";
    return `${user.tag ?? user.username ?? "unknown"} (${user.id})`;
}

function indent(text) {
    return text.split("\n").join("\n    ");
}

function formatMessage(message) {
    const lines = [`[${formatTime(message.createdTimestamp)}] ${formatUser(message.author)}: ${indent(message.content || "")}`.trimEnd()];

    for (const attachment of message.attachments?.values?.() ?? []) {
        lines.push(`    [attachment] ${attachment.name ?? "file"}: ${attachment.url}`);
    }

    for (const embed of message.embeds ?? []) {
        const parts = [embed.title, embed.description].filter(Boolean).join(" — ");
        if (parts) lines.push(`    [embed] ${indent(parts)}`);
    }

    for (const sticker of message.stickers?.values?.() ?? []) {
        lines.push(`    [sticker] ${sticker.name}`);
    }

    return lines.join("\n");
}

function buildTranscriptText({ ticket, categoryLabel, guildName, channelName, messages, opener, claimer, closedBy, closedAt, reason, truncated }) {
    const header = [
        `Ticket #${ticket.id} — ${categoryLabel}`,
        `Server: ${guildName}`,
        `Channel: #${channelName}`,
        `Opened by: ${formatUser(opener)} at ${formatTime(ticket.created_at)}`,
        `Claimed by: ${claimer ? formatUser(claimer) : "nobody"}`,
        `Closed by: ${formatUser(closedBy)} at ${formatTime(closedAt)}`,
        `Reason: ${reason || "No reason provided"}`,
        `Messages: ${messages.length}${truncated ? ` (only the most recent ${MAX_MESSAGES} are included)` : ""}`,
        "=".repeat(60),
        ""
    ].join("\n");

    return header + messages.map(formatMessage).join("\n");
}

module.exports = { MAX_MESSAGES, fetchAllMessages, buildTranscriptText };
