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

const FORM_PREFIX = "promoter_form_";
const DEFAULT_TITLE = "Promoter Applications";
const DEFAULT_BUTTON_LABEL = "Promoter";
const EMBED_COLOR = "#7B2FF7";
const PROMOTER_CATEGORY_ID = "1557430773353680938";

const command = new SlashCommandBuilder()
    .setName("promoter")
    .setDescription("Posts a promoter announcement with a button that opens an application ticket.")
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
    .setName("promoter-applications")
    .setDescription("Opens or closes promoter applications (while closed, the button shows a notice).")
    .addStringOption(option =>
        option
            .setName("action")
            .setDescription("Open or close promoter applications")
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

function ephemeral(interaction, content) {
    return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

function isAdmin(interaction) {
    return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

function isForm(customId) {
    return customId.startsWith(FORM_PREFIX);
}

function isValidUrl(text) {
    try {
        const url = new URL(text);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

async function handleCommand(interaction, client) {
    if (!isAdmin(interaction)) return ephemeral(interaction, "❌ Only administrators can use this command.");

    const channel = interaction.options.getChannel("channel");

    const channelPermissions = channel.permissionsFor(client.user);
    if (!channelPermissions
        || !channelPermissions.has(PermissionFlagsBits.ViewChannel)
        || !channelPermissions.has(PermissionFlagsBits.SendMessages)
        || !channelPermissions.has(PermissionFlagsBits.EmbedLinks)) {
        return ephemeral(interaction, `❌ I need View Channel, Send Messages and Embed Links in ${channel}.`);
    }

    const modal = new ModalBuilder()
        .setCustomId(`${FORM_PREFIX}${channel.id}`)
        .setTitle("Promoter Announcement");

    const titleInput = new TextInputBuilder()
        .setCustomId("title")
        .setLabel("Title")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(`📝 ${DEFAULT_TITLE}`)
        .setMaxLength(256)
        .setRequired(false);

    const messageInput = new TextInputBuilder()
        .setCustomId("message")
        .setLabel("Message")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Please include links to your channel(s), the platform(s) you use...")
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
        .setPlaceholder(DEFAULT_BUTTON_LABEL)
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
    const channelId = interaction.customId.slice(FORM_PREFIX.length);
    const title = interaction.fields.getTextInputValue("title").trim() || DEFAULT_TITLE;
    const message = interaction.fields.getTextInputValue("message");
    const image = interaction.fields.getTextInputValue("image").trim();
    const buttonLabel = interaction.fields.getTextInputValue("button").trim() || DEFAULT_BUTTON_LABEL;

    if (image && !isValidUrl(image)) {
        return ephemeral(interaction, "❌ That image link is not a valid http(s) address. Use a direct link that starts with `https://`.");
    }

    const guild = interaction.guild;
    const channel = guild.channels.cache.get(channelId)
        || await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return ephemeral(interaction, "❌ Target channel could not be found.");

    // Fail now (with a clear message) instead of when the first person clicks.
    const category = guild.channels.cache.get(PROMOTER_CATEGORY_ID)
        || await guild.channels.fetch(PROMOTER_CATEGORY_ID).catch(() => null);
    const categoryPermissions = category?.permissionsFor?.(client.user);
    if (!category || category.type !== ChannelType.GuildCategory) {
        return ephemeral(interaction, `❌ The promotion ticket category (${PROMOTER_CATEGORY_ID}) could not be found.`);
    }
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
            .setCustomId(tickets.PROMOTER_BUTTON_ID)
            .setLabel(buttonLabel)
            .setEmoji("🎥")
            .setStyle(ButtonStyle.Secondary)
    );

    try {
        await channel.send({ embeds: [embed], components: [row] });
        return ephemeral(interaction, `✅ Announcement posted in ${channel}. Applications open as tickets in **${category.name}**.`);
    } catch (error) {
        console.error("Failed to post the promoter announcement:", error);
        return ephemeral(interaction, "❌ Failed to post the announcement. Check my permissions in that channel (and that the image link works).");
    }
}

async function handleStatusCommand(interaction) {
    if (!isAdmin(interaction)) return ephemeral(interaction, "❌ Only administrators can use this command.");

    const close = interaction.options.getString("action") === "close";
    const message = interaction.options.getString("message")?.trim() || null;

    ticketsDb.setPromoterClosed(interaction.guild.id, close, close ? message : null);

    if (!close) {
        return ephemeral(interaction, "✅ Promoter applications are now **open**. The button creates tickets again.");
    }

    return ephemeral(
        interaction,
        "🔒 Promoter applications are now **closed**. People who click the button will see only for themselves:\n\n" +
        `>>> ${message || tickets.DEFAULT_CLOSED_NOTICE}\n\n` +
        "Use `/promoter-applications action:Open applications` to open them again."
    );
}

module.exports = {
    commands: [command, statusCommand],
    isForm,
    handleCommand,
    handleForm,
    handleStatusCommand
};
