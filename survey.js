const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");
const db = require("./survey-db.js");

const VOTE_PREFIX = "survey_vote_";
const FORM_PREFIX = "survey_form_";
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;
const MAX_LABEL_LENGTH = 80;
const OPEN_COLOR = "#7B2FF7";
const ENDED_COLOR = "#2b2d31";

function isAdmin(interaction) {
    return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

function deny(interaction) {
    return interaction.reply({
        content: "❌ Only administrators can use this command.",
        flags: MessageFlags.Ephemeral
    });
}

function isVoteButton(customId) {
    return customId.startsWith(VOTE_PREFIX);
}

function isSurveyForm(customId) {
    return customId.startsWith(FORM_PREFIX);
}

function buildVoteRows(surveyId, options, disabled = false) {
    const rows = [];
    for (let i = 0; i < options.length; i += 5) {
        rows.push(
            new ActionRowBuilder().addComponents(
                options.slice(i, i + 5).map(option =>
                    new ButtonBuilder()
                        .setCustomId(`${VOTE_PREFIX}${surveyId}_${option.idx}`)
                        .setLabel(option.label)
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(disabled)
                )
            )
        );
    }
    return rows;
}

function buildOpenEmbed(survey) {
    return new EmbedBuilder()
        .setColor(OPEN_COLOR)
        .setTitle(`📊 ${survey.question}`)
        .setDescription(
            "Click a button below to vote.\n" +
            "You can change your vote by clicking another option, or click your choice again to remove it."
        )
        .setFooter({ text: `Survey #${survey.id}` });
}

function buildBar(percent) {
    const filled = Math.round(percent / 10);
    return "▰".repeat(filled) + "▱".repeat(10 - filled);
}

function buildResultLines(options, counts, totalVotes) {
    return options.map(option => {
        const votes = counts.get(option.idx) ?? 0;
        const percent = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
        return `**${option.label}**\n${buildBar(percent)} ${votes} vote${votes === 1 ? "" : "s"} (${percent}%)`;
    }).join("\n\n");
}

function sumVotes(counts) {
    let total = 0;
    for (const votes of counts.values()) total += votes;
    return total;
}

function buildEndedEmbed(survey, options, counts) {
    const total = sumVotes(counts);

    return new EmbedBuilder()
        .setColor(ENDED_COLOR)
        .setTitle(`📊 ${survey.question}`)
        .setDescription(`**Survey ended**\n\n${buildResultLines(options, counts, total)}`)
        .addFields({ name: "Total voters", value: `${total}`, inline: true })
        .setFooter({ text: `Survey #${survey.id}` });
}

function messageLink(survey) {
    return survey.message_id
        ? `https://discord.com/channels/${survey.guild_id}/${survey.channel_id}/${survey.message_id}`
        : null;
}

async function handleCommand(interaction, client) {
    if (!isAdmin(interaction)) return deny(interaction);

    const sub = interaction.options.getSubcommand();
    if (sub === "create") return handleCreate(interaction, client);
    if (sub === "end") return handleEnd(interaction, client);
    if (sub === "results") return handleResults(interaction);
}

async function handleCreate(interaction, client) {
    const channel = interaction.options.getChannel("channel");
    const permissions = channel.permissionsFor(client.user);
    if (!permissions || !permissions.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.SendMessages)) {
        return interaction.reply({
            content: `❌ I don't have permission to send messages in ${channel}.`,
            flags: MessageFlags.Ephemeral
        });
    }

    const modal = new ModalBuilder()
        .setCustomId(`${FORM_PREFIX}${channel.id}`)
        .setTitle("New Survey");

    const questionInput = new TextInputBuilder()
        .setCustomId("question")
        .setLabel("Question")
        .setStyle(TextInputStyle.Short)
        .setMaxLength(200)
        .setRequired(true);

    const optionsInput = new TextInputBuilder()
        .setCustomId("options")
        .setLabel(`Options (one per line, ${MIN_OPTIONS}-${MAX_OPTIONS})`)
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Option 1\nOption 2\nOption 3")
        .setMaxLength(1500)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(questionInput),
        new ActionRowBuilder().addComponents(optionsInput)
    );

    return interaction.showModal(modal);
}

async function handleForm(interaction) {
    const channelId = interaction.customId.slice(FORM_PREFIX.length);
    const question = interaction.fields.getTextInputValue("question").trim();
    const rawOptions = interaction.fields.getTextInputValue("options")
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 0);

    const options = [...new Set(rawOptions)];

    if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
        return interaction.reply({
            content: `❌ Please give between ${MIN_OPTIONS} and ${MAX_OPTIONS} different options (one per line). You gave ${options.length}.`,
            flags: MessageFlags.Ephemeral
        });
    }

    const tooLong = options.find(option => option.length > MAX_LABEL_LENGTH);
    if (tooLong) {
        return interaction.reply({
            content: `❌ Each option can be at most ${MAX_LABEL_LENGTH} characters: "${tooLong.slice(0, 40)}..." is too long.`,
            flags: MessageFlags.Ephemeral
        });
    }

    const channel = interaction.guild.channels.cache.get(channelId)
        || await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel) {
        return interaction.reply({
            content: "❌ Target channel could not be found.",
            flags: MessageFlags.Ephemeral
        });
    }

    const surveyId = db.createSurvey({
        guildId: interaction.guild.id,
        channelId,
        question,
        createdBy: interaction.user.id,
        options
    });

    try {
        const survey = db.getSurvey(surveyId);
        const dbOptions = db.getOptions(surveyId);
        const message = await channel.send({
            embeds: [buildOpenEmbed(survey)],
            components: buildVoteRows(surveyId, dbOptions)
        });
        db.setMessageId(surveyId, message.id);

        return interaction.reply({
            content: `✅ Survey **#${surveyId}** posted in ${channel}. End it with \`/survey end\`, check live numbers with \`/survey results\`.`,
            flags: MessageFlags.Ephemeral
        });
    } catch (error) {
        console.error("Failed to post survey:", error);
        db.deleteSurvey(surveyId);
        return interaction.reply({
            content: "❌ Failed to post the survey. Check my permissions in that channel.",
            flags: MessageFlags.Ephemeral
        });
    }
}

async function resolveSurvey(interaction) {
    const surveyId = Number(interaction.options.getString("survey"));
    const survey = Number.isInteger(surveyId) ? db.getSurvey(surveyId) : null;

    if (!survey || survey.guild_id !== interaction.guild.id) {
        await interaction.reply({ content: "❌ Survey not found.", flags: MessageFlags.Ephemeral });
        return null;
    }
    return survey;
}

async function handleEnd(interaction, client) {
    const survey = await resolveSurvey(interaction);
    if (!survey) return;

    if (survey.status !== "running") {
        return interaction.reply({
            content: `❌ Survey #${survey.id} has already ended.`,
            flags: MessageFlags.Ephemeral
        });
    }

    db.markEnded(survey.id);

    const options = db.getOptions(survey.id);
    const counts = db.getVoteCounts(survey.id);
    const total = sumVotes(counts);

    let edited = false;
    try {
        const channel = client.channels.cache.get(survey.channel_id)
            || await client.channels.fetch(survey.channel_id).catch(() => null);
        const message = channel && survey.message_id
            ? await channel.messages.fetch(survey.message_id).catch(() => null)
            : null;

        if (message) {
            await message.edit({
                embeds: [buildEndedEmbed(survey, options, counts)],
                components: buildVoteRows(survey.id, options, true)
            });
            edited = true;
        }
    } catch (error) {
        console.error(`Failed to update survey #${survey.id} message:`, error.message);
    }

    return interaction.reply({
        content: edited
            ? `✅ Survey **#${survey.id}** ended with **${total}** voter${total === 1 ? "" : "s"}. Final results are on the survey message.`
            : `⚠️ Survey **#${survey.id}** ended with **${total}** voter${total === 1 ? "" : "s"}, but I couldn't update its message (deleted?).\n\n${buildResultLines(options, counts, total)}`,
        flags: MessageFlags.Ephemeral
    });
}

async function handleResults(interaction) {
    const surveyOption = interaction.options.getString("survey");

    if (!surveyOption) {
        const running = db.getRunningSurveys(interaction.guild.id);
        if (running.length === 0) {
            return interaction.reply({ content: "There are no active surveys.", flags: MessageFlags.Ephemeral });
        }

        const lines = running.slice(0, 15).map(survey => {
            const voters = sumVotes(db.getVoteCounts(survey.id));
            const link = messageLink(survey);
            return `**#${survey.id}** ${survey.question} — **${voters}** voter${voters === 1 ? "" : "s"}` +
                (link ? ` — [open](${link})` : "");
        });

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(OPEN_COLOR)
                    .setTitle(`📊 Active surveys (${running.length})`)
                    .setDescription(`${lines.join("\n")}\n\nUse \`/survey results survey:<one>\` for the full breakdown.`)
            ],
            flags: MessageFlags.Ephemeral
        });
    }

    const survey = await resolveSurvey(interaction);
    if (!survey) return;

    const options = db.getOptions(survey.id);
    const counts = db.getVoteCounts(survey.id);
    const total = sumVotes(counts);
    const members = interaction.guild.memberCount;
    const percent = members > 0 ? Math.round((total / members) * 100) : 0;
    const link = messageLink(survey);

    const embed = new EmbedBuilder()
        .setColor(survey.status === "running" ? OPEN_COLOR : ENDED_COLOR)
        .setTitle(`📊 #${survey.id} — ${survey.question}`)
        .setDescription(buildResultLines(options, counts, total))
        .addFields(
            { name: "Voted", value: `${total}`, inline: true },
            { name: "Haven't voted", value: `${Math.max(members - total, 0)}`, inline: true },
            { name: "Participation", value: `${percent}% of ${members} members`, inline: true }
        )
        .setFooter({ text: survey.status === "running" ? "Live results (only visible to you)" : "Survey ended" });
    if (link) embed.addFields({ name: "Message", value: `[Jump to survey](${link})` });

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleVote(interaction) {
    const [surveyId, optionIdx] = interaction.customId.slice(VOTE_PREFIX.length).split("_").map(Number);
    const survey = Number.isInteger(surveyId) ? db.getSurvey(surveyId) : null;

    if (!survey || survey.guild_id !== interaction.guild.id || survey.status !== "running") {
        return interaction.reply({
            content: "❌ This survey has ended.",
            flags: MessageFlags.Ephemeral
        });
    }

    const option = db.getOptions(surveyId).find(o => o.idx === optionIdx);
    if (!option) {
        return interaction.reply({
            content: "❌ This option no longer exists.",
            flags: MessageFlags.Ephemeral
        });
    }

    const result = db.castVote(surveyId, interaction.user.id, optionIdx);
    const content = {
        voted: `✅ Your vote for **${option.label}** has been recorded.`,
        changed: `🔄 Your vote was changed to **${option.label}**.`,
        removed: `↩️ Your vote for **${option.label}** was removed.`
    }[result];

    return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function handleAutocomplete(interaction) {
    if (!isAdmin(interaction)) return interaction.respond([]);

    const typed = interaction.options.getFocused().toLowerCase();

    const choices = db.getRunningSurveys(interaction.guild.id)
        .map(survey => ({ name: `#${survey.id} ${survey.question}`.slice(0, 100), value: String(survey.id) }))
        .filter(choice => choice.name.toLowerCase().includes(typed))
        .slice(0, 25);

    return interaction.respond(choices);
}

module.exports = {
    isVoteButton,
    isSurveyForm,
    handleCommand,
    handleForm,
    handleVote,
    handleAutocomplete
};
