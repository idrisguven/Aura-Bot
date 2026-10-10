// ================================
// APPLICATION ANNOUNCEMENTS (/promoter, /teamapplication)
// ================================
// Each kind gets: a command that posts an announcement with an "apply"
// button, and a command that opens/closes applications. The button itself
// (opening the ticket / showing the closed notice) lives in tickets.js.

const {
    SlashCommandBuilder,
    ChannelType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");
const tickets = require("./tickets.js");
const ticketsDb = require("./tickets-db.js");

const EMBED_COLOR = "#7B2FF7";

function isValidUrl(text) {
    try {
        const url = new URL(text);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

function ephemeral(interaction, content) {
    return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

function isAdmin(interaction) {
    return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

/**
 * config: {
 *   kind,                      // key in tickets.js APPLICATIONS / CATEGORIES ("promoter", "team")
 *   displayName,               // "Promoter", "Team"
 *   commandName, statusCommandName, formPrefix,
 *   commandDescription, statusDescription,
 *   modalTitle, defaultTitle, defaultButtonLabel, buttonEmoji, messagePlaceholder
 * }
 */
function createApplicationFeature(config) {
    const application = tickets.APPLICATIONS[config.kind];
    const ticketCategory = tickets.CATEGORIES[config.kind];

    const command = new SlashCommandBuilder()
        .setName(config.commandName)
        .setDescription(config.commandDescription)
        .addChannelOption(option =>
            option
                .setName("channel")
                .setDescription("Channel to post the announcement in")
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .toJSON();

    const statusCommand = new SlashCommandBuilder()
        .setName(config.statusCommandName)
        .setDescription(config.statusDescription)
        .addStringOption(option =>
            option
                .setName("action")
                .setDescription(`Open or close ${config.displayName.toLowerCase()} applications`)
                .addChoices(
                    { name: "Open applications", value: "open" },
                    { name: "Close applications", value: "close" }
                )
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("message")
                .setDescription("Notice people see while closed (optional, a default notice is used if empty)")
                .setMaxLength(1500)
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .toJSON();

    async function handleCommand(interaction, client) {
        if (!isAdmin(interaction)) return ephemeral(interaction, "❌ Only administrators can use this command.");

        const channel = interaction.options.getChannel("channel");

        const permissions = channel.permissionsFor(client.user);
        if (!permissions
            || !permissions.has(PermissionFlagsBits.ViewChannel)
            || !permissions.has(PermissionFlagsBits.SendMessages)
            || !permissions.has(PermissionFlagsBits.EmbedLinks)) {
            return ephemeral(interaction, `❌ I need View Channel, Send Messages and Embed Links in ${channel}.`);
        }

        const modal = new ModalBuilder()
            .setCustomId(`${config.formPrefix}${channel.id}`)
            .setTitle(config.modalTitle);

        const titleInput = new TextInputBuilder()
            .setCustomId("title")
            .setLabel("Title")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(`📝 ${config.defaultTitle}`)
            .setMaxLength(256)
            .setRequired(false);

        const messageInput = new TextInputBuilder()
            .setCustomId("message")
            .setLabel("Message")
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder(config.messagePlaceholder)
            .setMaxLength(4000)
            .setRequired(true);

        const imageInput = new TextInputBuilder()
            .setCustomId("image")
            .setLabel("Image link (optional, shown under the text)")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("https://... (direct link to a .png / .jpg)")
            .setMaxLength(500)
            .setRequired(false);

        const buttonInput = new TextInputBuilder()
            .setCustomId("button")
            .setLabel("Button text (optional)")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(config.defaultButtonLabel)
            .setMaxLength(80)
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(messageInput),
            new ActionRowBuilder().addComponents(imageInput),
            new ActionRowBuilder().addComponents(buttonInput)
        );

        return interaction.showModal(modal);
    }

    async function handleForm(interaction, client) {
        const channelId = interaction.customId.slice(config.formPrefix.length);
        const title = interaction.fields.getTextInputValue("title").trim() || config.defaultTitle;
        const message = interaction.fields.getTextInputValue("message");
        const image = interaction.fields.getTextInputValue("image").trim();
        const buttonLabel = interaction.fields.getTextInputValue("button").trim() || config.defaultButtonLabel;

        if (image && !isValidUrl(image)) {
            return ephemeral(interaction, "❌ That image link is not a valid http(s) address. Use a direct link that starts with `https://`.");
        }

        const guild = interaction.guild;
        const channel = guild.channels.cache.get(channelId)
            || await guild.channels.fetch(channelId).catch(() => null);
        if (!channel) return ephemeral(interaction, "❌ Target channel could not be found.");

        // Fail now (with a clear message) instead of when the first person clicks.
        const category = guild.channels.cache.get(ticketCategory.parentId)
            || await guild.channels.fetch(ticketCategory.parentId).catch(() => null);
        if (!category || category.type !== ChannelType.GuildCategory) {
            return ephemeral(interaction, `❌ The ${config.displayName.toLowerCase()} ticket category (${ticketCategory.parentId}) could not be found.`);
        }
        const categoryPermissions = category.permissionsFor?.(client.user);
        if (!categoryPermissions?.has(PermissionFlagsBits.ViewChannel) || !categoryPermissions?.has(PermissionFlagsBits.ManageChannels)) {
            return ephemeral(interaction, `❌ I need View Channel and Manage Channels in the **${category.name}** category to create tickets there.`);
        }

        const embed = new EmbedBuilder()
            .setColor(EMBED_COLOR)
            .setTitle(title)
            .setDescription(message);
        if (image) embed.setImage(image);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(application.buttonId)
                .setLabel(buttonLabel)
                .setEmoji(config.buttonEmoji)
                .setStyle(ButtonStyle.Secondary)
        );

        try {
            await channel.send({ embeds: [embed], components: [row] });
            return ephemeral(interaction, `✅ Announcement posted in ${channel}. Applications open as tickets in **${category.name}**.`);
        } catch (error) {
            console.error(`Failed to post the ${config.kind} announcement:`, error);
            return ephemeral(interaction, "❌ Failed to post the announcement. Check my permissions in that channel (and that the image link works).");
        }
    }

    async function handleStatusCommand(interaction) {
        if (!isAdmin(interaction)) return ephemeral(interaction, "❌ Only administrators can use this command.");

        const close = interaction.options.getString("action") === "close";
        const message = interaction.options.getString("message")?.trim() || null;

        ticketsDb.setApplicationClosed(interaction.guild.id, config.kind, close, close ? message : null);

        if (!close) {
            return ephemeral(interaction, `✅ ${config.displayName} applications are now **open**. The button creates tickets again.`);
        }

        return ephemeral(
            interaction,
            `🔒 ${config.displayName} applications are now **closed**. People who click the button will see only for themselves:\n\n` +
            `>>> ${message || application.defaultClosedNotice}\n\n` +
            `Use \`/${config.statusCommandName} action:Open applications\` to open them again.`
        );
    }

    /** Returns true if the interaction belonged to this feature and was handled. */
    async function handle(interaction, client) {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === config.commandName) { await handleCommand(interaction, client); return true; }
            if (interaction.commandName === config.statusCommandName) { await handleStatusCommand(interaction); return true; }
        }

        if (interaction.isModalSubmit() && interaction.customId.startsWith(config.formPrefix)) {
            await handleForm(interaction, client);
            return true;
        }

        return false;
    }

    return { commands: [command, statusCommand], handle };
}

module.exports = { createApplicationFeature };
