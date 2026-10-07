const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require("discord.js");

require("dotenv").config();

process.on("unhandledRejection", (reason) => {
    console.error("Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", error);
});

const PLAYER_ROLE_ID = "1557353276641644634";
const RULES_ACCEPT_BUTTON_ID = "rules_accept";
const RULES_FORM_PREFIX = "rules_form_";
const EMBED_COLOR = "#7B2FF7";

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

const commands = [
    new SlashCommandBuilder()
        .setName("rules")
        .setDescription("Posts the server rules with an Accept button that grants the Player role.")
        .addChannelOption(option =>
            option
                .setName("channel")
                .setDescription("Channel to post the rules in")
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .toJSON()
];

client.once("clientReady", async () => {
    console.log(`Bot online: ${client.user.tag}`);

    if (!process.env.GUILD_ID) {
        console.error("GUILD_ID is not set in .env. Slash commands were not registered.");
        return;
    }

    try {
        const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
            { body: commands }
        );
        console.log(`Slash commands registered to guild ${process.env.GUILD_ID}.`);
    } catch (error) {
        console.error("Failed to register slash commands:", error);
    }
});

function buildAcceptRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(RULES_ACCEPT_BUTTON_ID)
            .setLabel("Accept")
            .setEmoji("✅")
            .setStyle(ButtonStyle.Success)
    );
}

async function handleRulesCommand(interaction) {
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
        .setCustomId(`${RULES_FORM_PREFIX}${channel.id}`)
        .setTitle("Server Rules");

    const titleInput = new TextInputBuilder()
        .setCustomId("title")
        .setLabel("Title (optional)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Server Rules")
        .setMaxLength(256)
        .setRequired(false);

    const rulesInput = new TextInputBuilder()
        .setCustomId("rules")
        .setLabel("Rules")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Write or paste the rules here...")
        .setMaxLength(4000)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(titleInput),
        new ActionRowBuilder().addComponents(rulesInput)
    );

    return interaction.showModal(modal);
}

async function handleRulesForm(interaction) {
    const channelId = interaction.customId.slice(RULES_FORM_PREFIX.length);
    const title = interaction.fields.getTextInputValue("title")?.trim() || "Server Rules";
    const rules = interaction.fields.getTextInputValue("rules");

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
        .setDescription(rules);

    try {
        await channel.send({ embeds: [embed], components: [buildAcceptRow()] });
        return interaction.reply({
            content: `✅ Rules posted in ${channel}.`,
            flags: MessageFlags.Ephemeral
        });
    } catch (error) {
        console.error("Failed to post rules:", error);
        return interaction.reply({
            content: "❌ Failed to post the rules. Check my permissions in that channel.",
            flags: MessageFlags.Ephemeral
        });
    }
}

async function handleRulesAccept(interaction) {
    const member = interaction.member;

    if (member.roles.cache.has(PLAYER_ROLE_ID)) {
        return interaction.reply({
            content: "✅ You've already accepted the rules and have the Player role.",
            flags: MessageFlags.Ephemeral
        });
    }

    const role = interaction.guild.roles.cache.get(PLAYER_ROLE_ID);
    if (!role) {
        console.error(`Player role ${PLAYER_ROLE_ID} not found in guild ${interaction.guild.id}.`);
        return interaction.reply({
            content: "❌ The Player role could not be found. Please contact an administrator.",
            flags: MessageFlags.Ephemeral
        });
    }

    const me = await interaction.guild.members.fetchMe();
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles) || me.roles.highest.position <= role.position) {
        console.error("Cannot assign Player role: missing Manage Roles or my highest role is not above it.");
        return interaction.reply({
            content: "❌ I can't assign the Player role right now. Please contact an administrator.",
            flags: MessageFlags.Ephemeral
        });
    }

    try {
        await member.roles.add(role, "Accepted the server rules");
        return interaction.reply({
            content: "✅ Thanks for accepting the rules! You now have the **Player** role.",
            flags: MessageFlags.Ephemeral
        });
    } catch (error) {
        console.error("Failed to assign Player role:", error);
        return interaction.reply({
            content: "❌ Something went wrong while assigning your role. Please contact an administrator.",
            flags: MessageFlags.Ephemeral
        });
    }
}

client.on("interactionCreate", async interaction => {
    try {
        if (interaction.isChatInputCommand() && interaction.commandName === "rules") {
            return await handleRulesCommand(interaction);
        }

        if (interaction.isModalSubmit() && interaction.customId.startsWith(RULES_FORM_PREFIX)) {
            return await handleRulesForm(interaction);
        }

        if (interaction.isButton() && interaction.customId === RULES_ACCEPT_BUTTON_ID) {
            return await handleRulesAccept(interaction);
        }
    } catch (error) {
        console.error("Interaction error:", error);
    }
});

client.login(process.env.DISCORD_TOKEN);
