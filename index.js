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
const tickets = require("./tickets.js");
const automod = require("./automod.js");
const massDm = require("./massdm.js");
const promoter = require("./promoter.js");
const bulkdm = require("./bulkdm.js");
const { createAcceptPanel, RULES_PANEL_CONFIG, MARKETPLACE_PANEL_CONFIG } = require("./acceptpanel.js");

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const rulesPanel = createAcceptPanel(RULES_PANEL_CONFIG, client);
const marketplacePanel = createAcceptPanel(MARKETPLACE_PANEL_CONFIG, client);

const commands = [
    massDm.command,
    promoter.command,

    ...rulesPanel.commands,
    ...marketplacePanel.commands,

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
        .setName("ticket-panel")
        .setDescription("Posts the ticket panel (type menu) in a channel.")
        .addChannelOption(option =>
            option
                .setName("channel")
                .setDescription("Channel to post the ticket panel in")
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(true)
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

    // Continue any mass DM the previous run left unfinished.
    bulkdm.resumeUnfinishedJobs(client).catch(error => {
        console.error("Could not resume unfinished mass DM jobs:", error);
    });

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

client.on("interactionCreate", async interaction => {
    try {
        if (massDm.isMassDmInteraction(interaction)) {
            return await massDm.handle(interaction, client);
        }

        if (await rulesPanel.handle(interaction) || await marketplacePanel.handle(interaction)) return;

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

        if (interaction.isChatInputCommand() && interaction.commandName === "promoter") {
            return await promoter.handleCommand(interaction, client);
        }

        if (interaction.isModalSubmit() && promoter.isForm(interaction.customId)) {
            return await promoter.handleForm(interaction);
        }

        if (interaction.isButton() && tickets.isPromoterButton(interaction.customId)) {
            return await tickets.handlePromoterButton(interaction, client);
        }

        if (interaction.isChatInputCommand() && interaction.commandName === "ticket-panel") {
            return await tickets.handlePanelCommand(interaction, client);
        }

        if (interaction.isModalSubmit() && tickets.isPanelForm(interaction.customId)) {
            return await tickets.handlePanelForm(interaction);
        }

        if (interaction.isStringSelectMenu() && interaction.customId === tickets.SELECT_ID) {
            return await tickets.handleSelect(interaction, client);
        }

        if (interaction.isButton() && tickets.isTicketButton(interaction.customId)) {
            return await tickets.handleButton(interaction);
        }

        if (interaction.isModalSubmit() && interaction.customId === tickets.CLOSE_FORM_ID) {
            return await tickets.handleCloseForm(interaction, client);
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

    } catch (error) {
        console.error("Interaction error:", error);
    }
});

client.on("messageCreate", async message => {
    try {
        // A removed message must not get the suggestion reactions.
        if (await automod.handleMessage(message)) return;
        await suggestions.handleMessage(message);
    } catch (error) {
        console.error("Message handler error:", error);
    }
});

// Someone could post a clean message and edit the bad words in afterwards.
client.on("messageUpdate", (oldMessage, newMessage) => {
    automod.handleMessage(newMessage).catch(error => console.error("Automod (edit) error:", error));
});

client.on("guildMemberRemove", member => {
    quitLog.handleMemberRemove(member).catch(error => console.error("Quit log error:", error));
});

client.on("guildMemberAdd", member => {
    welcome.handleMemberAdd(member).catch(error => console.error("Join message error:", error));
});

client.login(process.env.DISCORD_TOKEN);
