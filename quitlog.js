const QUIT_LOG_CHANNEL_ID = "1557427960410275901";

async function handleMemberRemove(member) {
    if (member.user?.bot) return;

    const channel = member.guild.channels.cache.get(QUIT_LOG_CHANNEL_ID)
        || await member.guild.channels.fetch(QUIT_LOG_CHANNEL_ID).catch(() => null);
    if (!channel) return;

    try {
        await channel.send({
            content: `❌ <@${member.id}> quit from server`,
            allowedMentions: { parse: [] }
        });
    } catch (error) {
        console.error("Failed to send quit log:", error.message);
    }
}

module.exports = { QUIT_LOG_CHANNEL_ID, handleMemberRemove };
