const SUGGESTIONS_CHANNEL_ID = "1557446637746520194";
const VOTE_EMOJIS = ["✅", "❌"];

/**
 * Adds ✅ and ❌ to every member message posted in the suggestions
 * channel, so people can vote on it by clicking one of them.
 */
async function handleMessage(message) {
    if (message.channelId !== SUGGESTIONS_CHANNEL_ID) return;
    if (message.author.bot || message.system) return;

    try {
        for (const emoji of VOTE_EMOJIS) {
            await message.react(emoji);
        }
    } catch (error) {
        console.error(`Failed to add vote reactions to suggestion ${message.id}:`, error.message);
    }
}

module.exports = { SUGGESTIONS_CHANNEL_ID, handleMessage };
