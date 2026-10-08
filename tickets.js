const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    AttachmentBuilder,
    ChannelType,
    OverwriteType,
    PermissionFlagsBits,
    PermissionsBitField,
    MessageFlags
} = require("discord.js");
const db = require("./tickets-db.js");
const transcript = require("./transcript.js");

const TRANSCRIPT_CHANNEL_ID = "1557433146599931934";

const PANEL_FORM_PREFIX = "ticket_panel_form_";
const SELECT_ID = "ticket_select";
const CLAIM_BUTTON_ID = "ticket_claim";
const CLOSE_BUTTON_ID = "ticket_close";
const CLOSE_FORM_ID = "ticket_close_form";
const EMBED_COLOR = "#7B2FF7";
const CLOSED_COLOR = "#ED4245";
const DELETE_DELAY_MS = 5000;

// parentId = the Discord category (folder) the ticket channel is created in.
const CATEGORIES = {
    general: {
        label: "General Issue",
        emoji: "❓",
        description: "Questions and general problems",
        parentId: "1557430697721856070"
    },
    payment: {
        label: "Payment Issue",
        emoji: "💳",
        description: "Problems with a payment or purchase",
        parentId: "1557430773353680938"
    },
    hack: {
        label: "Hack Report",
        emoji: "🚨",
        description: "Report a hacker or a compromised account",
        parentId: "1557430746325581916"
    }
};

function isStaff(interaction) {
    const permissions = interaction.memberPermissions;
    return Boolean(
        permissions?.has(PermissionFlagsBits.Administrator) ||
        permissions?.has(PermissionFlagsBits.ManageChannels) ||
        permissions?.has(PermissionFlagsBits.ManageMessages)
    );
}

function isTicketButton(customId) {
    return customId === CLAIM_BUTTON_ID || customId === CLOSE_BUTTON_ID;
}

function isPanelForm(customId) {
    return customId.startsWith(PANEL_FORM_PREFIX);
}

function sanitizeName(name) {
    const cleaned = String(name)
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 30);
    return cleaned || "user";
}

function buildPanelRow() {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(SELECT_ID)
            .setPlaceholder("Select a ticket type...")
            .addOptions(
                Object.entries(CATEGORIES).map(([key, category]) => ({
                    label: category.label,
                    value: key,
                    description: category.description,
                    emoji: category.emoji
                }))
            )
    );
}

function buildTicketEmbed(ticket) {
    const category = CATEGORIES[ticket.category];
    const embed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle(`🎫 Ticket #${ticket.id} — ${category.label}`)
        .setDescription(
            `Hello <@${ticket.user_id}>, please describe your issue below.\n` +
            "You can send messages, links and images. A staff member will be with you shortly."
        )
        .addFields(
            { name: "Opened by", value: `<@${ticket.user_id}>`, inline: true },
            { name: "Category", value: `${category.emoji} ${category.label}`, inline: true }
        );

    if (ticket.claimed_by) {
        embed.addFields({ name: "Claimed by", value: `<@${ticket.claimed_by}>`, inline: true });
    }
    return embed;
}

function buildTicketButtons(claimed) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(CLAIM_BUTTON_ID)
            .setLabel(claimed ? "Claimed" : "Claim")
            .setEmoji("🙋")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(claimed),
        new ButtonBuilder()
            .setCustomId(CLOSE_BUTTON_ID)
            .setLabel("Close Ticket")
            .setEmoji("🔒")
            .setStyle(ButtonStyle.Danger)
    );
}

/**
 * The ticket channel keeps the category's own permissions (so the staff
 * roles you already set on the category can see it), hides it from
 * @everyone and opens it up for the person who made the ticket.
 */
function buildOverwrites(guild, parent, openerId, botId) {
    const overwrites = new Map();
    for (const overwrite of parent.permissionOverwrites.cache.values()) {
        overwrites.set(overwrite.id, {
            id: overwrite.id,
            type: overwrite.type,
            allow: new PermissionsBitField(overwrite.allow.bitfield),
            deny: new PermissionsBitField(overwrite.deny.bitfield)
        });
    }

    const everyone = overwrites.get(guild.id) ?? {
        id: guild.id,
        type: OverwriteType.Role,
        allow: new PermissionsBitField(),
        deny: new PermissionsBitField()
    };
    everyone.allow.remove(PermissionFlagsBits.ViewChannel);
    everyone.deny.add(PermissionFlagsBits.ViewChannel);
    overwrites.set(guild.id, everyone);

    const channelBasics = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
    ];

    overwrites.set(openerId, {
        id: openerId,
        type: OverwriteType.Member,
        allow: new PermissionsBitField(channelBasics),
        deny: new PermissionsBitField()
    });

    overwrites.set(botId, {
        id: botId,
        type: OverwriteType.Member,
        allow: new PermissionsBitField([...channelBasics, PermissionFlagsBits.ManageChannels]),
        deny: new PermissionsBitField()
    });

    return [...overwrites.values()];
}

// ---------- /ticket-panel ----------

async function handlePanelCommand(interaction, client) {
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

    const modal = new ModalBuilder()
        .setCustomId(`${PANEL_FORM_PREFIX}${channel.id}`)
        .setTitle("Ticket Panel");

    const titleInput = new TextInputBuilder()
        .setCustomId("title")
        .setLabel("Title (optional)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Support Tickets")
        .setMaxLength(256)
        .setRequired(false);

    const messageInput = new TextInputBuilder()
        .setCustomId("message")
        .setLabel("Panel message")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Need help? Pick a ticket type from the menu below...")
        .setMaxLength(4000)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(titleInput),
        new ActionRowBuilder().addComponents(messageInput)
    );

    return interaction.showModal(modal);
}

async function handlePanelForm(interaction) {
    const channelId = interaction.customId.slice(PANEL_FORM_PREFIX.length);
    const title = interaction.fields.getTextInputValue("title")?.trim() || "Support Tickets";
    const message = interaction.fields.getTextInputValue("message");

    const channel = interaction.guild.channels.cache.get(channelId)
        || await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel) {
        return interaction.reply({
            content: "❌ Target channel could not be found.",
            flags: MessageFlags.Ephemeral
        });
    }

    const embed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle(title)
        .setDescription(message);

    try {
        await channel.send({ embeds: [embed], components: [buildPanelRow()] });
        return interaction.reply({
            content: `✅ Ticket panel posted in ${channel}.`,
            flags: MessageFlags.Ephemeral
        });
    } catch (error) {
        console.error("Failed to post ticket panel:", error);
        return interaction.reply({
            content: "❌ Failed to post the ticket panel. Check my permissions in that channel.",
            flags: MessageFlags.Ephemeral
        });
    }
}

// ---------- opening a ticket ----------

async function handleSelect(interaction, client) {
    const key = interaction.values[0];
    const category = CATEGORIES[key];

    // Selecting an option leaves it highlighted in the menu; putting a fresh
    // menu back lets people pick the same type again later.
    interaction.message.edit({ components: [buildPanelRow()] }).catch(() => {});

    if (!category) {
        return interaction.reply({
            content: "❌ That ticket type is no longer available.",
            flags: MessageFlags.Ephemeral
        });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guild = interaction.guild;
    const member = interaction.member;

    const existing = db.getOpenTicket(guild.id, member.id, key);
    if (existing) {
        return interaction.editReply({
            content: existing.channel_id
                ? `❌ You already have an open **${category.label}** ticket: <#${existing.channel_id}>`
                : "⏳ Your ticket is already being created, please wait a moment."
        });
    }

    const parent = guild.channels.cache.get(category.parentId)
        || await guild.channels.fetch(category.parentId).catch(() => null);
    if (!parent || parent.type !== ChannelType.GuildCategory) {
        console.error(`Ticket category ${category.parentId} (${category.label}) not found or not a category.`);
        return interaction.editReply({
            content: "❌ This ticket type is not set up correctly. Please contact an administrator."
        });
    }

    const ticketId = db.createTicket({ guildId: guild.id, userId: member.id, category: key });
    let channel = null;

    try {
        channel = await guild.channels.create({
            name: `${sanitizeName(member.displayName)}-ticket${ticketId}`,
            type: ChannelType.GuildText,
            parent: parent.id,
            topic: `Ticket #${ticketId} | ${category.label} | opened by ${member.id}`,
            permissionOverwrites: buildOverwrites(guild, parent, member.id, client.user.id),
            reason: `Ticket #${ticketId} opened by ${member.user.tag}`
        });
        db.setChannelId(ticketId, channel.id);

        const ticket = db.getTicket(ticketId);
        await channel.send({
            content: `<@${member.id}>`,
            embeds: [buildTicketEmbed(ticket)],
            components: [buildTicketButtons(false)],
            allowedMentions: { users: [member.id] }
        });

        return interaction.editReply({ content: `✅ Your ticket has been created: ${channel}` });
    } catch (error) {
        console.error(`Failed to create ticket #${ticketId}:`, error);
        db.deleteTicket(ticketId);
        if (channel) await channel.delete("Ticket creation failed").catch(() => {});
        return interaction.editReply({
            content: "❌ I couldn't create your ticket. Please try again or contact an administrator."
        });
    }
}

// ---------- inside a ticket ----------

async function handleButton(interaction) {
    if (!isStaff(interaction)) {
        return interaction.reply({
            content: "❌ Only staff members can use this button.",
            flags: MessageFlags.Ephemeral
        });
    }

    const ticket = db.getTicketByChannel(interaction.channel.id);
    if (!ticket) {
        return interaction.reply({
            content: "❌ This channel is not a ticket.",
            flags: MessageFlags.Ephemeral
        });
    }

    if (interaction.customId === CLAIM_BUTTON_ID) {
        return handleClaim(interaction, ticket);
    }

    if (ticket.status === "closed") {
        await interaction.reply({
            content: "🔒 This ticket is already closed. Deleting the channel...",
            flags: MessageFlags.Ephemeral
        });
        scheduleDelete(interaction.channel);
        return;
    }

    const modal = new ModalBuilder()
        .setCustomId(CLOSE_FORM_ID)
        .setTitle(`Close Ticket #${ticket.id}`);

    const reasonInput = new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("Reason (optional)")
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(500)
        .setRequired(false);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    return interaction.showModal(modal);
}

async function handleClaim(interaction, ticket) {
    if (ticket.status !== "open") {
        return interaction.reply({
            content: "❌ This ticket is already closed.",
            flags: MessageFlags.Ephemeral
        });
    }

    if (!db.claimTicket(ticket.id, interaction.user.id)) {
        const current = db.getTicket(ticket.id);
        return interaction.reply({
            content: `❌ This ticket is already claimed by <@${current.claimed_by}>.`,
            flags: MessageFlags.Ephemeral
        });
    }

    return interaction.update({
        embeds: [buildTicketEmbed(db.getTicket(ticket.id))],
        components: [buildTicketButtons(true)]
    });
}

function scheduleDelete(channel) {
    setTimeout(() => {
        channel.delete("Ticket closed").catch(error =>
            console.error(`Failed to delete ticket channel ${channel.id}:`, error.message)
        );
    }, DELETE_DELAY_MS);
}

const closingTickets = new Set();

async function fetchUserOrId(client, userId) {
    return client.users.fetch(userId).catch(() => ({ id: userId }));
}

/** @returns {Promise<boolean>} whether the transcript reached the log channel */
async function postTranscript(client, interaction, ticket, category, reason, closedAt) {
    try {
        const guild = interaction.guild;
        const logChannel = guild.channels.cache.get(TRANSCRIPT_CHANNEL_ID)
            || await guild.channels.fetch(TRANSCRIPT_CHANNEL_ID).catch(() => null);
        if (!logChannel) {
            console.error(`Transcript channel ${TRANSCRIPT_CHANNEL_ID} not found.`);
            return false;
        }

        const messages = await transcript.fetchAllMessages(interaction.channel);
        const [opener, claimer] = await Promise.all([
            fetchUserOrId(client, ticket.user_id),
            ticket.claimed_by ? fetchUserOrId(client, ticket.claimed_by) : null
        ]);

        const text = transcript.buildTranscriptText({
            ticket,
            categoryLabel: category.label,
            guildName: guild.name,
            channelName: interaction.channel.name,
            messages,
            opener,
            claimer,
            closedBy: interaction.user,
            closedAt,
            reason,
            truncated: messages.length >= transcript.MAX_MESSAGES
        });

        const file = new AttachmentBuilder(Buffer.from(text, "utf8"), {
            name: `ticket-${ticket.id}-${interaction.channel.name}.txt`
        });

        const embed = new EmbedBuilder()
            .setColor(CLOSED_COLOR)
            .setTitle(`📄 Ticket #${ticket.id} closed`)
            .addFields(
                { name: "Category", value: `${category.emoji} ${category.label}`, inline: true },
                { name: "Opened by", value: `<@${ticket.user_id}>`, inline: true },
                { name: "Closed by", value: `${interaction.user}`, inline: true },
                { name: "Claimed by", value: ticket.claimed_by ? `<@${ticket.claimed_by}>` : "Nobody", inline: true },
                { name: "Opened", value: `<t:${Math.floor(ticket.created_at / 1000)}:f>`, inline: true },
                { name: "Closed", value: `<t:${Math.floor(closedAt / 1000)}:f>`, inline: true },
                { name: "Messages", value: `${messages.length}`, inline: true },
                { name: "Reason", value: reason || "No reason provided", inline: false }
            );

        await logChannel.send({ embeds: [embed], files: [file], allowedMentions: { parse: [] } });
        return true;
    } catch (error) {
        console.error(`Failed to post transcript for ticket #${ticket.id}:`, error);
        return false;
    }
}

async function handleCloseForm(interaction, client) {
    if (!isStaff(interaction)) {
        return interaction.reply({
            content: "❌ Only staff members can close tickets.",
            flags: MessageFlags.Ephemeral
        });
    }

    const ticket = db.getTicketByChannel(interaction.channel.id);
    if (!ticket || ticket.status !== "open") {
        return interaction.reply({
            content: "❌ This ticket is not open.",
            flags: MessageFlags.Ephemeral
        });
    }

    if (closingTickets.has(ticket.id)) {
        return interaction.reply({
            content: "⏳ This ticket is already being closed.",
            flags: MessageFlags.Ephemeral
        });
    }

    closingTickets.add(ticket.id);
    try {
        // Reading a long conversation can take longer than Discord's 3 seconds.
        await interaction.deferReply();

        const reason = interaction.fields.getTextInputValue("reason")?.trim() || null;
        const closedAt = Date.now();
        const category = CATEGORIES[ticket.category];

        // The transcript goes out BEFORE closing: if it can't be saved, the
        // ticket stays open so the conversation is never lost.
        const saved = await postTranscript(client, interaction, ticket, category, reason, closedAt);
        if (!saved) {
            return interaction.editReply({
                content:
                    `❌ I couldn't post the transcript to <#${TRANSCRIPT_CHANNEL_ID}>, so the ticket was **not** closed and nothing was deleted.\n` +
                    "Check my permissions in that channel (View Channel, Send Messages, Attach Files, Embed Links) and try again."
            });
        }

        db.closeTicket(ticket.id, interaction.user.id, reason);
        const closed = db.getTicket(ticket.id);

        const dmDelivered = await sendCloseDm(client, interaction, closed, category);

        await interaction.editReply({
            content:
                `🔒 Ticket **#${closed.id}** closed by ${interaction.user}.` +
                `${reason ? `\n**Reason:** ${reason}` : ""}\n` +
                `📄 Transcript saved in <#${TRANSCRIPT_CHANNEL_ID}>.\n` +
                `${dmDelivered ? "The ticket owner was notified by DM." : "⚠️ I couldn't DM the ticket owner (their DMs are closed or they left)."}\n` +
                `This channel will be deleted in ${DELETE_DELAY_MS / 1000} seconds.`,
            allowedMentions: { parse: [] }
        });

        scheduleDelete(interaction.channel);
    } finally {
        closingTickets.delete(ticket.id);
    }
}

async function sendCloseDm(client, interaction, ticket, category) {
    const openedUnix = Math.floor(ticket.created_at / 1000);
    const closedUnix = Math.floor(ticket.closed_at / 1000);

    const embed = new EmbedBuilder()
        .setColor(CLOSED_COLOR)
        .setTitle("🔒 Your ticket has been closed")
        .setDescription(`Your ticket in **${interaction.guild.name}** was closed.`)
        .addFields(
            { name: "Ticket", value: `#${ticket.id} — ${category.emoji} ${category.label}`, inline: false },
            { name: "Closed by", value: `${interaction.user} (${interaction.user.tag})`, inline: true },
            { name: "Opened", value: `<t:${openedUnix}:f>`, inline: true },
            { name: "Closed", value: `<t:${closedUnix}:f>`, inline: true },
            { name: "Reason", value: ticket.close_reason || "No reason provided", inline: false }
        );

    try {
        const user = await client.users.fetch(ticket.user_id);
        await user.send({ embeds: [embed] });
        return true;
    } catch (error) {
        console.warn(`Could not DM ticket #${ticket.id} owner:`, error.message);
        return false;
    }
}

const TICKET_CATEGORY_IDS = new Set(Object.values(CATEGORIES).map(category => category.parentId));

module.exports = {
    TICKET_CATEGORY_IDS,
    SELECT_ID,
    CLOSE_FORM_ID,
    isTicketButton,
    isPanelForm,
    handlePanelCommand,
    handlePanelForm,
    handleSelect,
    handleButton,
    handleCloseForm
};
