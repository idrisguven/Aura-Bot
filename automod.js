// ================================
// PROFANITY + ADVERTISING FILTER
// ================================
// A message that breaks a rule is deleted and the author gets a private DM
// (nothing is posted in the channel). Staff and ticket channels are exempt.

const { PermissionFlagsBits } = require("discord.js");
const { TICKET_CATEGORY_IDS } = require("./tickets.js");

// ---------- word list ----------

const PROFANITY_WORDS = [
    "fuck", "fucking", "fucked", "fucker", "fuckers", "motherfuck", "motherfucker", "motherfuckers", "motherfucking",
    "shit", "shits", "shitty", "bullshit", "shithead", "shitheads",
    "dick", "dickhead", "dickheads", "dicks", "dumbass", "dumbasses",
    "ass", "asses", "asshole", "assholes", "bastard", "bastards",
    "bitch", "bitches", "bitchy", "son of a bitch", "sob",
    "cunt", "cunts", "pussy", "pussies", "cock", "cocks", "cockhead",
    "prick", "pricks", "twat", "twats", "wanker", "wankers", "wank",
    "jerkoff", "jerk", "jerks", "jackass", "jackasses",
    "dipshit", "dipshits", "dumbfuck", "dumbfucks", "dumbfucker", "fuckwit", "fuckwits",
    "shitfuck", "shitfaced", "bullshitter", "asshat", "asshats",
    "arse", "arsehole", "arseholes", "bloody", "crap", "crappy", "bollocks",
    "bugger", "buggers", "tosser", "tossers", "bellend", "bellends",
    "knob", "knobhead", "knobheads", "twatwaffle",
    "douche", "douchebag", "douchebags", "scumbag", "scumbags", "scum",
    "moron", "morons", "idiot", "idiots", "imbecile", "imbeciles",
    "retard", "retarded", "retards", "loser", "losers",
    "stupid", "stupidity", "braindead", "brain-dead", "brain dead", "dumb",
    "degenerate", "degenerates", "screw you", "screw off",
    "piss", "pissed", "piss off", "pisshead", "pissheads",
    // common short spellings and run-together forms
    "fuk", "fck", "fuckyou", "fuckoff", "fuckme", "fuckthis", "fuckthat", "fuckin", "fucka",
    "fuckface", "fuckboy", "fuckhead", "phuck", "shitbag"
];

// Spellings with digits that don't map back to the real word through the
// usual leet table (c0nt -> "cont" instead of "cunt").
const RAW_WORDS = ["c0nt", "p0ssy"];

// Endings that are still the same insult ("fucks", "shitting", "bitched").
// Only for words where that can't clash with an innocent word.
const SUFFIXABLE = new Set(["fuck", "fuk", "fck", "shit", "bitch", "bullshit", "motherfuck", "dumbfuck"]);
const SUFFIX = "(?:e?s|ed|ing|er|ers)?";

const BOUNDARY_BEFORE = "(?<![\\p{L}\\p{N}])";
const BOUNDARY_AFTER = "(?![\\p{L}\\p{N}])";

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Turns "fuck" into /f+(u|*)+(c|*)+(k|*)+/: letters may be stretched
 * ("fuuuck"), later letters may be hidden behind "*" ("f**k"), but a double
 * letter ("ass") must really be doubled so that "as" never matches.
 */
function buildTokenPattern(token) {
    let out = "";
    let index = 0;

    for (const run of token.matchAll(/(.)\1*/gu)) {
        const char = escapeRegex(run[1]);
        const count = run[0].length;
        const unit = index === 0 ? char : `(?:${char}|\\*)`;
        out += count > 1 ? `${unit}{${count},}` : `${unit}+`;
        index++;
    }
    return out;
}

function buildWordPattern(word) {
    const body = word.split(/\s+/).map(buildTokenPattern).join("\\s+");
    return SUFFIXABLE.has(word) ? `${body}${SUFFIX}` : body;
}

function compile(words) {
    const alternatives = [...new Set(words)].map(buildWordPattern).join("|");
    return new RegExp(`${BOUNDARY_BEFORE}(?:${alternatives})${BOUNDARY_AFTER}`, "u");
}

const PROFANITY_REGEX = compile(PROFANITY_WORDS);
const RAW_REGEX = new RegExp(
    `${BOUNDARY_BEFORE}(?:${RAW_WORDS.map(escapeRegex).join("|")})${BOUNDARY_AFTER}`,
    "u"
);

// ---------- text normalisation ----------

const CONFUSABLES = {
    "а": "a", "с": "c", "е": "e", "о": "o", "р": "p", "х": "x", "у": "y", "і": "i", "ѕ": "s", "ј": "j", "һ": "h", "к": "k", "м": "m", "т": "t",
    "α": "a", "ε": "e", "ο": "o", "ρ": "p", "τ": "t", "ι": "i", "κ": "k", "υ": "u", "ν": "v"
};
const CONFUSABLES_REGEX = new RegExp(`[${Object.keys(CONFUSABLES).join("")}]`, "g");

const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s" };

function stripNonText(text) {
    return text
        .replace(/<a?:\w+:\d+>/g, " ")
        .replace(/<[@#&][!&]?\d+>/g, " ")
        .replace(/https?:\/\/\S+|www\.\S+/gi, " ");
}

function baseNormalize(text) {
    return stripNonText(text)
        .normalize("NFKC")
        .replace(/[​-‍⁠﻿­]/g, "")
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .replace(CONFUSABLES_REGEX, char => CONFUSABLES[char]);
}

// Digits/symbols are only turned back into letters inside words that also
// contain a real letter, so plain numbers ("455", "1.000.000") stay as they are.
function leetify(text) {
    return text
        .split(/(\s+)/)
        .map(token => (/\p{L}/u.test(token) && /[013457@$]/.test(token))
            ? token.replace(/[013457@$]/g, char => LEET[char])
            : token)
        .join("");
}

// "f u c k", "f.u.c.k", "f-u-c-k", "f_u_c_k" -> "fuck"
function joinSpelledOut(text) {
    return text.replace(
        /(?<![\p{L}\p{N}])\p{L}(?:[\s.\-_*]\p{L}){2,}(?![\p{L}\p{N}])/gu,
        match => match.replace(/[\s.\-_*]/g, "")
    );
}

// Innocent words that the stretched-letter matching would otherwise confuse
// with a listed word ("assess" fits the pattern for "asses").
const INNOCENT_REGEX = /(?<![p{L}p{N}])(?:assess)(?![p{L}p{N}])/gu;

function containsProfanity(content) {
    const base = baseNormalize(content).replace(INNOCENT_REGEX, " ");
    const leet = leetify(base);

    return [leet, joinSpelledOut(leet)].some(variant => PROFANITY_REGEX.test(variant))
        || RAW_REGEX.test(base);
}

// ---------- advertising ----------

const INVITE_PATTERNS = [
    /discord\s*(?:\.|\(dot\)|\bdot\b)\s*gg\b/i,
    /discord(?:app)?\s*\.\s*com\s*\/\s*invite\b/i,
    /\b(?:dsc\.gg|invite\.gg|discord\.me|discord\.io|disboard\.org)\b/i
];

const URL_REGEX = /(?:https?:\/\/|www\.)[^\s<>]+/giu;
const BARE_DOMAIN_REGEX = new RegExp(
    "(?<![@\\p{L}\\p{N}._/-])(?:[a-z0-9-]+\\.)+" +
    "(?:com|net|org|io|gg|xyz|info|biz|tv|club|online|site|store|shop|top|pro|app|dev|link|live|tk|ml|ga|cf|gq)" +
    "(?![\\p{L}\\p{N}-])(?:[/:][^\\s<>]*)?",
    "giu"
);

// Hosts that are fine to link (gifs, screenshots, Discord's own files).
const ALLOWED_HOSTS = [
    "tenor.com", "giphy.com", "imgur.com", "gyazo.com", "prnt.sc",
    "cdn.discordapp.com", "media.discordapp.net"
];
const DISCORD_HOSTS = new Set(["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"]);

function parseLink(raw) {
    let candidate = raw.replace(/^[<(\[]+|[>)\].,!?;:]+$/g, "");
    if (!/^https?:\/\//i.test(candidate)) candidate = `http://${candidate}`;

    try {
        const url = new URL(candidate);
        return { host: url.hostname.replace(/^www\./, "").toLowerCase(), path: url.pathname };
    } catch {
        return null;
    }
}

function isAllowedLink({ host, path }) {
    if (ALLOWED_HOSTS.some(allowed => host === allowed || host.endsWith(`.${allowed}`))) return true;
    // Links to other messages inside Discord are fine; invites are not.
    return DISCORD_HOSTS.has(host) && path.startsWith("/channels/");
}

function containsAdvertising(content) {
    const text = content
        .normalize("NFKC")
        .replace(/[​-‍⁠﻿­]/g, "")
        .toLowerCase();

    if (INVITE_PATTERNS.some(pattern => pattern.test(text))) return true;

    const links = text.match(URL_REGEX) ?? [];
    const withoutUrls = text.replace(URL_REGEX, " ");
    const bareDomains = withoutUrls.match(BARE_DOMAIN_REGEX) ?? [];

    return [...links, ...bareDomains]
        .map(parseLink)
        .some(link => link && !isAllowedLink(link));
}

// ---------- enforcement ----------

const WARNING_COOLDOWN_MS = 30_000;
const lastWarning = new Map();

const WARNINGS = {
    profanity: "🚫 **Profanity is not allowed** on this server.",
    advertising: "🚫 **Advertising is not allowed** on this server (Discord invites and links to other sites)."
};

function isExempt(message) {
    const permissions = message.member?.permissions;
    if (
        permissions?.has(PermissionFlagsBits.Administrator) ||
        permissions?.has(PermissionFlagsBits.ManageMessages) ||
        permissions?.has(PermissionFlagsBits.ManageGuild)
    ) {
        return true;
    }

    const parentId = message.channel?.parentId;
    return Boolean(parentId && TICKET_CATEGORY_IDS.has(parentId));
}

function findViolation(content) {
    if (containsProfanity(content)) return "profanity";
    if (containsAdvertising(content)) return "advertising";
    return null;
}

async function warnPrivately(message, violation) {
    const key = `${message.author.id}:${violation}`;
    const now = Date.now();
    if (now - (lastWarning.get(key) ?? 0) < WARNING_COOLDOWN_MS) return;
    lastWarning.set(key, now);

    try {
        await message.author.send(
            `${WARNINGS[violation]}\nYour message in **#${message.channel.name}** (${message.guild.name}) was removed.`
        );
    } catch {
        // DMs are closed — nothing else we can do without posting in the channel.
    }
}

/** @returns {Promise<boolean>} true if the message was removed */
async function handleMessage(message) {
    if (message.partial || !message.guild || !message.author || message.author.bot || message.system) return false;
    if (!message.content) return false;
    if (isExempt(message)) return false;

    const violation = findViolation(message.content);
    if (!violation) return false;

    try {
        await message.delete();
    } catch (error) {
        console.error(`Could not delete a ${violation} message in #${message.channel?.name}:`, error.message);
        return false;
    }

    await warnPrivately(message, violation);
    return true;
}

module.exports = { containsProfanity, containsAdvertising, handleMessage, PROFANITY_WORDS };
