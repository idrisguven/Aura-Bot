const {
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");
const bulkdm = require("./bulkdm.js");
const { ensureAllMembers } = require("./members.js");

const FORM_ID = "massdm_form";
const CONFIRM_ID = "massdm_confirm";
const CANCEL_ID = "massdm_cancel";

const command = new SlashCommandBuilder()
    .setName("massdm")
    .setDescription("Sends a direct message to every member of the server.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON();

// Drafts waiting for the admin's confirmation: adminId -> { baslik, mesaj, link, guildId, interaction }
const pending = new Map();

function isAdmin(interaction) {
    return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

function isValidUrl(text) {
    try {
        const url = new URL(text);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

function isMassDmInteraction(interaction) {
    if (interaction.isChatInputCommand()) return interaction.commandName === "massdm";
    if (interaction.isModalSubmit()) return interaction.customId === FORM_ID;
    if (interaction.isButton()) return interaction.customId === CONFIRM_ID || interaction.customId === CANCEL_ID;
    return false;
}

async function handleCommand(interaction) {
    if (!isAdmin(interaction)) {
        return interaction.reply({
            content: "❌ Only administrators can use this command.",
            flags: MessageFlags.Ephemeral
        });
    }

    const modal = new ModalBuilder()
        .setCustomId(FORM_ID)
        .setTitle("Send a DM to all members");

    const titleInput = new TextInputBuilder()
        .setCustomId("baslik")
        .setLabel("Title (optional)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Announcement title")
        .setMaxLength(256)
        .setRequired(false);

    // Kept under the embed description limit (4096) even with the link added.
    const messageInput = new TextInputBuilder()
        .setCustomId("mesaj")
        .setLabel("Message")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Write the message to send...")
        .setMaxLength(3500)
        .setRequired(true);

    const linkInput = new TextInputBuilder()
        .setCustomId("link")
        .setLabel("Link (optional)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("https://...")
        .setMaxLength(300)
        .setRequired(false);

    modal.addComponents(
        new ActionRowBuilder().addComponents(titleInput),
        new ActionRowBuilder().addComponents(messageInput),
        new ActionRowBuilder().addComponents(linkInput)
    );

    return interaction.showModal(modal);
}

async function handleForm(interaction) {
    if (!isAdmin(interaction)) {
        return interaction.reply({
            content: "❌ Only administrators can use this command.",
            flags: MessageFlags.Ephemeral
        });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (bulkdm.isGuildBusy(interaction.guild.id)) {
        return interaction.editReply({
            content: "⏳ A mass DM is still being sent in this server. Wait for it to finish."
        });
    }

    const baslik = interaction.fields.getTextInputValue("baslik").trim();
    const mesaj = interaction.fields.getTextInputValue("mesaj");
    const link = interaction.fields.getTextInputValue("link").trim();

    if (link && !isValidUrl(link)) {
        return interaction.editReply({
            content: "❌ That link is not a valid http(s) address. Please enter one that starts with `https://`."
        });
    }

    // Members are loaded here and kept in the cache; the confirm step must not
    // load them again. ensureAllMembers() skips the request when the list is
    // already complete and waits out Discord's rate limit when it isn't.
    let members;
    try {
        members = await ensureAllMembers(interaction.guild);
    } catch (error) {
        console.error("Failed to fetch the member list:", error);
        return interaction.editReply({
            content: `❌ Could not fetch the member list.\n\`\`\`${error.message || error}\`\`\``
        });
    }
    const realMemberCount = members.filter(member => !member.user.bot).size;

    // A newer draft by the same admin invalidates the older preview, so the
    // admin can never confirm a message other than the one they are looking at.
    const existing = pending.get(interaction.user.id);
    if (existing) {
        try {
            await existing.interaction.editReply({
                content: "❌ This confirmation was replaced by a newer draft from the same administrator.",
                embeds: [],
                components: []
            });
        } catch {
            // the old message can't be edited anymore (expired etc.) — fine
        }
    }

    pending.set(interaction.user.id, { baslik, mesaj, link, guildId: interaction.guild.id, interaction });

    const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(CONFIRM_ID)
            .setLabel("Yes, send")
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(CANCEL_ID)
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary)
    );

    return interaction.editReply({
        content:
            `⚠️ This will send a DM to **${realMemberCount}** members and **cannot be undone**.\n` +
            "This is exactly what they will receive:",
        embeds: [bulkdm.buildEmbed({ baslik, mesaj, link }, interaction.guild.name)],
        components: [confirmRow]
    });
}

async function handleButton(interaction, client) {
    const draft = pending.get(interaction.user.id);

    if (!draft) {
        return interaction.update({
            content: "❌ This confirmation is no longer valid (it expired or was already handled).",
            embeds: [],
            components: []
        });
    }

    if (interaction.customId === CANCEL_ID) {
        pending.delete(interaction.user.id);
        return interaction.update({
            content: "🚫 Mass DM cancelled.",
            embeds: [],
            components: []
        });
    }

    pending.delete(interaction.user.id);

    if (bulkdm.isGuildBusy(interaction.guild.id)) {
        return interaction.update({
            content: "⏳ Another mass DM has just started. Wait for it to finish.",
            embeds: [],
            components: []
        });
    }

    // The member list was already fetched when the form was submitted.
    const realMembers = interaction.guild.members.cache.filter(member => !member.user.bot);

    // The job is written to the database first: if the bot crashes or
    // restarts during the send, it continues where it stopped. Progress
    // reports go to this channel as normal messages instead of interaction
    // follow-ups, which stop working after 15 minutes.
    const jobId = bulkdm.db.createJob({
        guildId: interaction.guild.id,
        channelId: interaction.channel.id,
        adminId: interaction.user.id,
        baslik: draft.baslik,
        mesaj: draft.mesaj,
        link: draft.link,
        targetUserIds: [...realMembers.keys()]
    });

    // Even if confirming the button fails (e.g. it took too long), the job is
    // already saved and must still start.
    try {
        await interaction.update({
            content:
                `✅ Sending started (job #${jobId}). A DM will go to **${realMembers.size}** members.\n` +
                "⏳ Progress will be reported in this channel. If the bot restarts meanwhile, the send resumes automatically.",
            embeds: [],
            components: []
        });
    } catch (error) {
        console.error(`Mass DM job #${jobId}: could not update the confirmation message:`, error.message);
    }

    bulkdm.runJob(client, jobId).catch(error => {
        console.error(`Mass DM job #${jobId} failed to run:`, error);
    });
}

async function handle(interaction, client) {
    if (interaction.isChatInputCommand()) return handleCommand(interaction);
    if (interaction.isModalSubmit()) return handleForm(interaction);
    if (interaction.isButton()) return handleButton(interaction, client);
}

module.exports = { command, isMassDmInteraction, handle };
