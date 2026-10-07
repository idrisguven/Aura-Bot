const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");

const BUTTON_PREFIX = "country_";
const EMBED_COLOR = "#7B2FF7";

const LANGUAGES = [
    { name: "Deutsch", flag: "🇩🇪", roleId: "1557403887374442678" },
    { name: "Polski", flag: "🇵🇱", roleId: "1557404461037781153" },
    { name: "Română", flag: "🇷🇴", roleId: "1557404004986789969" },
    { name: "Türkçe", flag: "🇹🇷", roleId: "1557403996405104810" },
    { name: "Italiano", flag: "🇮🇹", roleId: "1557404269630587000" },
    { name: "Español", flag: "🇪🇸", roleId: "1557403989677711482" },
    { name: "Čeština", flag: "🇨🇿", roleId: "1557404576699785327" },
    { name: "Magyar", flag: "🇭🇺", roleId: "1557404261070151903" },
    { name: "Português", flag: "🇵🇹", roleId: "1557404001023033365" },
    { name: "Arabic", flag: "🇸🇦", roleId: "1557404333035888690" }
];

const LANGUAGES_BY_ROLE_ID = new Map(LANGUAGES.map(lang => [lang.roleId, lang]));

function buildPanel() {
    const embed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle("🌍 Choose Your Language")
        .setDescription(
            "Click a flag below to get your language role.\n" +
            "You can pick more than one. Click again to remove a role."
        );

    const rows = [];
    for (let i = 0; i < LANGUAGES.length; i += 5) {
        rows.push(
            new ActionRowBuilder().addComponents(
                LANGUAGES.slice(i, i + 5).map(lang =>
                    new ButtonBuilder()
                        .setCustomId(`${BUTTON_PREFIX}${lang.roleId}`)
                        .setLabel(lang.name)
                        .setEmoji(lang.flag)
                        .setStyle(ButtonStyle.Secondary)
                )
            )
        );
    }

    return { embeds: [embed], components: rows };
}

function isCountryButton(customId) {
    return customId.startsWith(BUTTON_PREFIX);
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

    try {
        await channel.send(buildPanel());
        return interaction.reply({
            content: `✅ Language selection posted in ${channel}.`,
            flags: MessageFlags.Ephemeral
        });
    } catch (error) {
        console.error("Failed to post language selection:", error);
        return interaction.reply({
            content: "❌ Failed to post the language selection. Check my permissions in that channel.",
            flags: MessageFlags.Ephemeral
        });
    }
}

async function handleButton(interaction) {
    const roleId = interaction.customId.slice(BUTTON_PREFIX.length);
    const language = LANGUAGES_BY_ROLE_ID.get(roleId);

    // Only the roles in our own list can ever be handed out, whatever the button says.
    if (!language) {
        return interaction.reply({
            content: "❌ This language option is no longer available.",
            flags: MessageFlags.Ephemeral
        });
    }

    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) {
        console.error(`Language role ${roleId} (${language.name}) not found in guild ${interaction.guild.id}.`);
        return interaction.reply({
            content: "❌ That role could not be found. Please contact an administrator.",
            flags: MessageFlags.Ephemeral
        });
    }

    const me = await interaction.guild.members.fetchMe();
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles) || me.roles.highest.position <= role.position) {
        console.error(`Cannot manage language role ${language.name}: missing Manage Roles or my highest role is not above it.`);
        return interaction.reply({
            content: "❌ I can't manage that role right now. Please contact an administrator.",
            flags: MessageFlags.Ephemeral
        });
    }

    const member = interaction.member;

    try {
        if (member.roles.cache.has(roleId)) {
            await member.roles.remove(role, "Language selection (removed)");
            return interaction.reply({
                content: `${language.flag} **${language.name}** role removed.`,
                flags: MessageFlags.Ephemeral
            });
        }

        await member.roles.add(role, "Language selection");
        return interaction.reply({
            content: `${language.flag} You now have the **${language.name}** role.`,
            flags: MessageFlags.Ephemeral
        });
    } catch (error) {
        console.error(`Failed to toggle language role ${language.name}:`, error);
        return interaction.reply({
            content: "❌ Something went wrong while updating your role. Please contact an administrator.",
            flags: MessageFlags.Ephemeral
        });
    }
}

module.exports = { LANGUAGES, isCountryButton, buildPanel, handleCommand, handleButton };
