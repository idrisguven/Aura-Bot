const { PermissionFlagsBits, MessageFlags } = require("discord.js");
const db = require("./welcome-db.js");
const { ensureAllMembers } = require("./members.js");

/**
 * Records everyone currently in the server as "already seen", so that if
 * any of them leaves and comes back they are announced as re-joined
 * (not as brand new). Safe to run repeatedly.
 */
async function seedExistingMembers(guild) {
    try {
        const members = await ensureAllMembers(guild);
        db.markManySeen(guild.id, members.filter(m => !m.user.bot).map(m => m.id));
    } catch (error) {
        console.error(`Failed to record existing members for guild ${guild.id}:`, error.message);
    }
}

async function handleCommand(interaction, client) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
            content: "❌ Only administrators can use this command.",
            flags: MessageFlags.Ephemeral
        });
    }

    const channel = interaction.options.getChannel("channel");
    const permissions = channel.permissionsFor(client.user);
    if (!permissions || !permissions.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.SendMessages)) {
        return interaction.reply({
            content: `❌ I don't have permission to send messages in ${channel}.`,
            flags: MessageFlags.Ephemeral
        });
    }

    db.setChannelId(interaction.guild.id, channel.id);

    await interaction.reply({
        content: `✅ Join/re-join messages will now be posted in ${channel}.`,
        flags: MessageFlags.Ephemeral
    });

    seedExistingMembers(interaction.guild);
}

async function handleMemberAdd(member) {
    if (member.user.bot) return;

    const channelId = db.getChannelId(member.guild.id);
    if (!channelId) return;

    const isFirstJoin = db.markSeen(member.guild.id, member.id);

    const channel = member.guild.channels.cache.get(channelId)
        || await member.guild.channels.fetch(channelId).catch(() => null);
    if (!channel) {
        console.warn(`Welcome channel ${channelId} not found in guild ${member.guild.id}.`);
        return;
    }

    const text = isFirstJoin
        ? `☑️ ${member} has just joined the server. Welcome!`
        : `🔂 ${member} has re-joined the server!`;

    try {
        await channel.send({ content: text, allowedMentions: { parse: [] } });
    } catch (error) {
        console.error("Failed to send join message:", error.message);
    }
}

module.exports = { handleCommand, handleMemberAdd, seedExistingMembers };
