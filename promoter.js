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
const { PROMOTER_BUTTON_PREFIX } = require("./tickets.js");

const FORM_PREFIX = "promoter_form_";
const DEFAULT_TITLE = "Promoter Applications";
const DEFAULT_BUTTON_LABEL = "Promoter";
const EMBED_COLOR = "#7B2FF7";

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
    .addChannelOption(option =>
        option
            .setName("category")
            .setDescription("Category where the promoter tickets will be created")
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON();

function ephemeral(interaction, content) {
    return interaction.reply({ content, flags: MessageFlags.Ephemeral });
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
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return ephemeral(interaction, "❌ Only administrators can use this command.");
    }

    const channel = interaction.options.getChannel("channel");
    const category = interaction.options.getChannel("category");

    const channelPermissions = channel.permissionsFor(client.user);
    if (!channelPermissions
        || !channelPermissions.has(PermissionFlagsBits.ViewChannel)
        || !channelPermissions.has(PermissionFlagsBits.SendMessages)
        || !channelPermissions.has(PermissionFlagsBits.EmbedLinks)) {
        return ephemeral(interaction, `❌ I need View Channel, Send Messages and Embed Links in ${channel}.`);
    }

    const categoryPermissions = category.permissionsFor(client.user);
    if (!categoryPermissions
        || !categoryPermissions.has(PermissionFlagsBits.ViewChannel)
        || !categoryPermissions.has(PermissionFlagsBits.ManageChannels)) {
        return ephemeral(interaction, `❌ I need View Channel and Manage Channels in the **${category.name}** category to create tickets there.`);
    }

    const modal = new ModalBuilder()
        .setCustomId(`${FORM_PREFIX}${channel.id}_${category.id}`)
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

async function handleForm(interaction) {
    const [channelId, categoryId] = interaction.customId.slice(FORM_PREFIX.length).split("_");
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

    const category = guild.channels.cache.get(categoryId)
        || await guild.channels.fetch(categoryId).catch(() => null);
    if (!category || category.type !== ChannelType.GuildCategory) {
        return ephemeral(interaction, "❌ The ticket category could not be found.");
    }

    const embed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle(title)
        .setDescription(message);
    if (image) embed.setImage(image);

    // The button remembers which category its tickets go to.
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${PROMOTER_BUTTON_PREFIX}${category.id}`)
            .setLabel(buttonLabel)
            .setEmoji("🎥")
            .setStyle(ButtonStyle.Secondary)
    );

    try {
        await channel.send({ embeds: [embed], components: [row] });
        return ephemeral(interaction, `✅ Announcement posted in ${channel}. Promoter tickets will open in **${category.name}**.`);
    } catch (error) {
        console.error("Failed to post the promoter announcement:", error);
        return ephemeral(interaction, "❌ Failed to post the announcement. Check my permissions in that channel (and that the image link works).");
    }
}

module.exports = { command, isForm, handleCommand, handleForm };
