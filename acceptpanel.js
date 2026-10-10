const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    SlashCommandBuilder,
    ChannelType,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");

const { formatTags, unformatTags } = require("./format.js");

const EMBED_COLOR = "#7B2FF7";

/**
 * Builds a "post a message with an Accept button that gives a role" feature
 * (used for both the server rules and the marketplace rules).
 *
 * config: {
 *   commandName, editCommandName, acceptButtonId, formPrefix, editPrefix,
 *   roleId, roleName, defaultTitle, modalTitle, editModalTitle,
 *   contentLabel, contentPlaceholder, messageNoun,
 *   commandDescription, editCommandDescription, channelOptionDescription,
 *   alreadyText, successText, auditReason
 * }
 */
function createAcceptPanel(config, client) {
    const commands = [
        new SlashCommandBuilder()
            .setName(config.commandName)
            .setDescription(config.commandDescription)
            .addChannelOption(option =>
                option
                    .setName("channel")
                    .setDescription(config.channelOptionDescription)
                    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                    .setRequired(true)
            )
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .toJSON(),

        new SlashCommandBuilder()
            .setName(config.editCommandName)
            .setDescription(config.editCommandDescription)
            .addStringOption(option =>
                option
                    .setName("message")
                    .setDescription("Message link (right-click > Copy Message Link) or message ID")
                    .setRequired(true)
            )
            .addChannelOption(option =>
                option
                    .setName("channel")
                    .setDescription("Only needed if you gave a message ID instead of a link")
                    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                    .setRequired(false)
            )
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .toJSON()
    ];

    function ephemeral(interaction, content) {
        return interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }

    function isAdmin(interaction) {
        return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
    }

    function buildAcceptRow() {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(config.acceptButtonId)
                .setLabel("Accept")
                .setEmoji("✅")
                .setStyle(ButtonStyle.Success)
        );
    }

    function buildInputs({ title, content }) {
        const titleInput = new TextInputBuilder()
            .setCustomId("title")
            .setLabel("Title (optional)")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(config.defaultTitle)
            .setMaxLength(256)
            .setRequired(false);
        if (title) titleInput.setValue(title);

        const contentInput = new TextInputBuilder()
            .setCustomId("content")
            .setLabel(config.contentLabel)
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(4000)
            .setRequired(true);
        if (content) contentInput.setValue(content.slice(0, 4000));
        else contentInput.setPlaceholder(config.contentPlaceholder);

        return [
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(contentInput)
        ];
    }

    async function handlePostCommand(interaction) {
        if (!isAdmin(interaction)) return ephemeral(interaction, "❌ Only administrators can use this command.");

        const channel = interaction.options.getChannel("channel");
        const permissions = channel.permissionsFor(client.user);
        if (!permissions || !permissions.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.SendMessages)) {
            return ephemeral(interaction, `❌ I don't have permission to send messages in ${channel}.`);
        }

        const modal = new ModalBuilder()
            .setCustomId(`${config.formPrefix}${channel.id}`)
            .setTitle(config.modalTitle)
            .addComponents(buildInputs({}));

        return interaction.showModal(modal);
    }

    async function handlePostForm(interaction) {
        const channelId = interaction.customId.slice(config.formPrefix.length);
        const title = interaction.fields.getTextInputValue("title")?.trim() || config.defaultTitle;
        const content = formatTags(interaction.fields.getTextInputValue("content"));

        const channel = interaction.guild.channels.cache.get(channelId)
            || await interaction.guild.channels.fetch(channelId).catch(() => null);
        if (!channel) return ephemeral(interaction, "❌ Target channel could not be found.");

        const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(title).setDescription(content);

        try {
            await channel.send({ embeds: [embed], components: [buildAcceptRow()] });
            return ephemeral(interaction, `✅ ${config.messageNoun} posted in ${channel}.`);
        } catch (error) {
            console.error(`Failed to post ${config.messageNoun}:`, error);
            return ephemeral(interaction, `❌ Failed to post the ${config.messageNoun.toLowerCase()}. Check my permissions in that channel.`);
        }
    }

    function parseMessageRef(input, fallbackChannelId) {
        const trimmed = input.trim();

        const link = trimmed.match(/discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
        if (link) return { guildId: link[1], channelId: link[2], messageId: link[3] };

        if (/^\d{17,20}$/.test(trimmed) && fallbackChannelId) {
            return { guildId: null, channelId: fallbackChannelId, messageId: trimmed };
        }
        return null;
    }

    async function fetchOwnMessage(guild, ref) {
        if (ref.guildId && ref.guildId !== guild.id) return null;

        const channel = guild.channels.cache.get(ref.channelId)
            || await guild.channels.fetch(ref.channelId).catch(() => null);
        if (!channel?.messages) return null;

        const message = await channel.messages.fetch(ref.messageId).catch(() => null);
        if (!message || message.author.id !== client.user.id || message.embeds.length === 0) return null;

        return message;
    }

    async function handleEditCommand(interaction) {
        if (!isAdmin(interaction)) return ephemeral(interaction, "❌ Only administrators can use this command.");

        const ref = parseMessageRef(
            interaction.options.getString("message"),
            interaction.options.getChannel("channel")?.id
        );
        if (!ref) {
            return ephemeral(interaction, "❌ I couldn't read that. Paste the message link (right-click the message > Copy Message Link), or give a message ID together with the `channel` option.");
        }

        const message = await fetchOwnMessage(interaction.guild, ref);
        if (!message) {
            return ephemeral(interaction, `❌ I couldn't find a ${config.messageNoun.toLowerCase()} posted by me there.`);
        }

        const embed = message.embeds[0];
        const modal = new ModalBuilder()
            .setCustomId(`${config.editPrefix}${ref.channelId}_${ref.messageId}`)
            .setTitle(config.editModalTitle)
            .addComponents(buildInputs({ title: embed.title, content: unformatTags(embed.description ?? "") }));

        return interaction.showModal(modal);
    }

    async function handleEditForm(interaction) {
        const [channelId, messageId] = interaction.customId.slice(config.editPrefix.length).split("_");
        const title = interaction.fields.getTextInputValue("title")?.trim() || config.defaultTitle;
        const content = formatTags(interaction.fields.getTextInputValue("content"));

        const message = await fetchOwnMessage(interaction.guild, { guildId: null, channelId, messageId });
        if (!message) {
            return ephemeral(interaction, `❌ The ${config.messageNoun.toLowerCase()} could not be found anymore (was it deleted?).`);
        }

        const embed = EmbedBuilder.from(message.embeds[0]).setTitle(title).setDescription(content);

        try {
            await message.edit({ embeds: [embed] });
            return ephemeral(interaction, `✅ ${config.messageNoun} updated: ${message.url}`);
        } catch (error) {
            console.error(`Failed to edit ${config.messageNoun}:`, error);
            return ephemeral(interaction, `❌ Failed to edit the ${config.messageNoun.toLowerCase()}.`);
        }
    }

    async function handleAccept(interaction) {
        const member = interaction.member;

        if (member.roles.cache.has(config.roleId)) {
            return ephemeral(interaction, config.alreadyText);
        }

        const role = interaction.guild.roles.cache.get(config.roleId);
        if (!role) {
            console.error(`${config.roleName} role ${config.roleId} not found in guild ${interaction.guild.id}.`);
            return ephemeral(interaction, `❌ The ${config.roleName} role could not be found. Please contact an administrator.`);
        }

        const me = await interaction.guild.members.fetchMe();
        if (!me.permissions.has(PermissionFlagsBits.ManageRoles) || me.roles.highest.position <= role.position) {
            console.error(`Cannot assign ${config.roleName} role: missing Manage Roles or my highest role is not above it.`);
            return ephemeral(interaction, `❌ I can't assign the ${config.roleName} role right now. Please contact an administrator.`);
        }

        try {
            await member.roles.add(role, config.auditReason);
            return ephemeral(interaction, config.successText);
        } catch (error) {
            console.error(`Failed to assign ${config.roleName} role:`, error);
            return ephemeral(interaction, "❌ Something went wrong while assigning your role. Please contact an administrator.");
        }
    }

    /** Returns true if the interaction belonged to this panel and was handled. */
    async function handle(interaction) {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === config.commandName) { await handlePostCommand(interaction); return true; }
            if (interaction.commandName === config.editCommandName) { await handleEditCommand(interaction); return true; }
        }

        if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith(config.formPrefix)) { await handlePostForm(interaction); return true; }
            if (interaction.customId.startsWith(config.editPrefix)) { await handleEditForm(interaction); return true; }
        }

        if (interaction.isButton() && interaction.customId === config.acceptButtonId) {
            await handleAccept(interaction);
            return true;
        }

        return false;
    }

    return { commands, handle };
}

const PLAYER_ROLE_ID = "1557353276641644634";
const TRADER_ROLE_ID = "1557440024536948847";

const RULES_PANEL_CONFIG = {
    commandName: "rules",
    editCommandName: "rules-edit",
    acceptButtonId: "rules_accept",
    formPrefix: "rules_form_",
    editPrefix: "rules_edit_",
    roleId: PLAYER_ROLE_ID,
    roleName: "Player",
    defaultTitle: "Server Rules",
    modalTitle: "Server Rules",
    editModalTitle: "Edit Server Rules",
    contentLabel: "Rules",
    contentPlaceholder: "Write or paste the rules here...",
    messageNoun: "Rules",
    commandDescription: "Posts the server rules with an Accept button that grants the Player role.",
    editCommandDescription: "Edits a rules message posted by the bot (the Accept button stays).",
    channelOptionDescription: "Channel to post the rules in",
    alreadyText: "✅ You've already accepted the rules and have the Player role.",
    successText: "✅ Thanks for accepting the rules! You now have the **Player** role.",
    auditReason: "Accepted the server rules"
};

const MARKETPLACE_PANEL_CONFIG = {
    commandName: "marketplace",
    editCommandName: "marketplace-edit",
    acceptButtonId: "marketplace_accept",
    formPrefix: "marketplace_form_",
    editPrefix: "marketplace_edit_",
    roleId: TRADER_ROLE_ID,
    roleName: "Trader",
    defaultTitle: "Marketplace Rules",
    modalTitle: "Marketplace Rules",
    editModalTitle: "Edit Marketplace Rules",
    contentLabel: "Marketplace rules",
    contentPlaceholder: "Write or paste the marketplace rules here...",
    messageNoun: "Marketplace message",
    commandDescription: "Posts the marketplace rules with an Accept button that grants the Trader role.",
    editCommandDescription: "Edits a marketplace message posted by the bot (the Accept button stays).",
    channelOptionDescription: "Channel to post the marketplace rules in",
    alreadyText: "✅ You've already accepted the marketplace rules and have the Trader role.",
    successText: "✅ Thanks for accepting the marketplace rules! You now have the **Trader** role.",
    auditReason: "Accepted the marketplace rules"
};

module.exports = { createAcceptPanel, RULES_PANEL_CONFIG, MARKETPLACE_PANEL_CONFIG };
