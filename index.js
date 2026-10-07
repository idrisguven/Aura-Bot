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

const countrySelection = require("./countryselection.js");
const welcome = require("./welcome.js");
const survey = require("./survey.js");
const suggestions = require("./suggestions.js");
const quitLog = require("./quitlog.js");

const PLAYER_ROLE_ID = "1557353276641644634";
const RULES_ACCEPT_BUTTON_ID = "rules_accept";
const RULES_FORM_PREFIX = "rules_form_";
const RULES_EDIT_PREFIX = "rules_edit_";
const EMBED_COLOR = "#7B2FF7";

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages]
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
        .toJSON(),

    new SlashCommandBuilder()
        .setName("rules-edit")
        .setDescription("Edits a rules message posted by the bot (the Accept button stays).")
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
        .toJSON(),

    new SlashCommandBuilder()
        .setName("welcome")
        .setDescription("Sets the channel where join and re-join messages are posted.")
        .addChannelOption(option =>
            option
                .setName("channel")
                .setDescription("Channel for join/re-join messages")
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .toJSON(),

    new SlashCommandBuilder()
        .setName("survey")
        .setDescription("Create, end and check button surveys.")
        .addSubcommand(sub =>
            sub
                .setName("create")
                .setDescription("Creates a survey with button options in a channel.")
                .addChannelOption(option =>
                    option
                        .setName("channel")
                        .setDescription("Channel to post the survey in")
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName("end")
                .setDescription("Ends a running survey and posts the final results.")
                .addStringOption(option =>
                    option
                        .setName("survey")
                        .setDescription("The survey to end")
                        .setAutocomplete(true)
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName("results")
                .setDescription("Shows live numbers (only to you). Leave empty to list all active surveys.")
                .addStringOption(option =>
                    option
                        .setName("survey")
                        .setDescription("The survey to inspect")
                        .setAutocomplete(true)
                        .setRequired(false)
                )
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .toJSON(),

    new SlashCommandBuilder()
        .setName("countryselection")
        .setDescription("Posts the language selection panel (flag buttons that give language roles).")
        .addChannelOption(option =>
            option
                .setName("channel")
                .setDescription("Channel to post the language selection in")
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .toJSON()
];

client.once("clientReady", async () => {
    console.log(`Bot online: ${client.user.tag}`);

    for (const guild of client.guilds.cache.values()) {
        welcome.seedExistingMembers(guild);
    }

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

function parseMessageRef(input, fallbackChannelId) {
    const trimmed = input.trim();

    const link = trimmed.match(/discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
    if (link) return { guildId: link[1], channelId: link[2], messageId: link[3] };

    if (/^\d{17,20}$/.test(trimmed) && fallbackChannelId) {
        return { guildId: null, channelId: fallbackChannelId, messageId: trimmed };
    }

    return null;
}

async function fetchRulesMessage(guild, ref) {
    if (ref.guildId && ref.guildId !== guild.id) return null;

    const channel = guild.channels.cache.get(ref.channelId)
        || await guild.channels.fetch(ref.channelId).catch(() => null);
    if (!channel?.messages) return null;

    const message = await channel.messages.fetch(ref.messageId).catch(() => null);
    if (!message || message.author.id !== client.user.id || message.embeds.length === 0) return null;

    return message;
}

async function handleRulesEditCommand(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
            content: "❌ Only administrators can use this command.",
            flags: MessageFlags.Ephemeral
        });
    }

    const input = interaction.options.getString("message");
    const channelOption = interaction.options.getChannel("channel");
    const ref = parseMessageRef(input, channelOption?.id);

    if (!ref) {
        return interaction.reply({
            content: "❌ I couldn't read that. Paste the message link (right-click the message > Copy Message Link), or give a message ID together with the `channel` option.",
            flags: MessageFlags.Ephemeral
        });
    }

    const message = await fetchRulesMessage(interaction.guild, ref);
    if (!message) {
        return interaction.reply({
            content: "❌ I couldn't find a rules message posted by me there.",
            flags: MessageFlags.Ephemeral
        });
    }

    const embed = message.embeds[0];

    const modal = new ModalBuilder()
        .setCustomId(`${RULES_EDIT_PREFIX}${ref.channelId}_${ref.messageId}`)
        .setTitle("Edit Server Rules");

    const titleInput = new TextInputBuilder()
        .setCustomId("title")
        .setLabel("Title (optional)")
        .setStyle(TextInputStyle.Short)
        .setMaxLength(256)
        .setRequired(false);
    if (embed.title) titleInput.setValue(embed.title);

    const rulesInput = new TextInputBuilder()
        .setCustomId("rules")
        .setLabel("Rules")
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(4000)
        .setRequired(true);
    if (embed.description) rulesInput.setValue(embed.description.slice(0, 4000));

    modal.addComponents(
        new ActionRowBuilder().addComponents(titleInput),
        new ActionRowBuilder().addComponents(rulesInput)
    );

    return interaction.showModal(modal);
}

async function handleRulesEditForm(interaction) {
    const [channelId, messageId] = interaction.customId.slice(RULES_EDIT_PREFIX.length).split("_");
    const title = interaction.fields.getTextInputValue("title")?.trim() || "Server Rules";
    const rules = interaction.fields.getTextInputValue("rules");

    const message = await fetchRulesMessage(interaction.guild, { guildId: null, channelId, messageId });
    if (!message) {
        return interaction.reply({
            content: "❌ The rules message could not be found anymore (was it deleted?).",
            flags: MessageFlags.Ephemeral
        });
    }

    const embed = EmbedBuilder.from(message.embeds[0]).setTitle(title).setDescription(rules);

    try {
        await message.edit({ embeds: [embed] });
        return interaction.reply({
            content: `✅ Rules updated: ${message.url}`,
            flags: MessageFlags.Ephemeral
        });
    } catch (error) {
        console.error("Failed to edit rules:", error);
        return interaction.reply({
            content: "❌ Failed to edit the rules message.",
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

        if (interaction.isChatInputCommand() && interaction.commandName === "rules-edit") {
            return await handleRulesEditCommand(interaction);
        }

        if (interaction.isModalSubmit() && interaction.customId.startsWith(RULES_FORM_PREFIX)) {
            return await handleRulesForm(interaction);
        }

        if (interaction.isModalSubmit() && interaction.customId.startsWith(RULES_EDIT_PREFIX)) {
            return await handleRulesEditForm(interaction);
        }

        if (interaction.isAutocomplete() && interaction.commandName === "survey") {
            return await survey.handleAutocomplete(interaction);
        }

        if (interaction.isChatInputCommand() && interaction.commandName === "survey") {
            return await survey.handleCommand(interaction, client);
        }

        if (interaction.isModalSubmit() && survey.isSurveyForm(interaction.customId)) {
            return await survey.handleForm(interaction);
        }

        if (interaction.isButton() && survey.isVoteButton(interaction.customId)) {
            return await survey.handleVote(interaction);
        }

        if (interaction.isChatInputCommand() && interaction.commandName === "welcome") {
            return await welcome.handleCommand(interaction, client);
        }

        if (interaction.isChatInputCommand() && interaction.commandName === "countryselection") {
            return await countrySelection.handleCommand(interaction, client);
        }

        if (interaction.isButton() && countrySelection.isCountryButton(interaction.customId)) {
            return await countrySelection.handleButton(interaction);
        }

        if (interaction.isButton() && interaction.customId === RULES_ACCEPT_BUTTON_ID) {
            return await handleRulesAccept(interaction);
        }
    } catch (error) {
        console.error("Interaction error:", error);
    }
});

client.on("messageCreate", message => {
    suggestions.handleMessage(message).catch(error => console.error("Suggestions error:", error));
});

client.on("guildMemberRemove", member => {
    quitLog.handleMemberRemove(member).catch(error => console.error("Quit log error:", error));
});

client.on("guildMemberAdd", member => {
    welcome.handleMemberAdd(member).catch(error => console.error("Join message error:", error));
});

client.login(process.env.DISCORD_TOKEN);
