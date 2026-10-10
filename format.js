// ================================
// MESSAGE FORMAT TAGS
// ================================
// Discord can colour text inside a code block that is marked "ansi", but the
// colour codes use a hidden control character that can't be typed into a
// form. So admins write tags like {red}text{/red} inside a ``` block and
// this turns them into the real codes (and marks the block as ansi).
// Outside a code block there is no way to colour text, so tags are removed.

const ESC = "\u001b";

const CODES = {
    gray: "30",
    red: "31",
    green: "32",
    yellow: "33",
    blue: "34",
    pink: "35",
    cyan: "36",
    white: "37",
    bold: "1",
    underline: "4"
};

const NAMES = Object.keys(CODES).join("|");
const TAG_PAIR = new RegExp(`\\{(${NAMES})\\}([\\s\\S]*?)\\{/\\1\\}`, "gi");
const ANY_TAG = new RegExp(`\\{/?(?:${NAMES})\\}`, "gi");
const HAS_TAG = new RegExp(`\\{(?:${NAMES})\\}[\\s\\S]*?\\{/(?:${NAMES})\\}`, "i");
const CODE_BLOCK = /```([^\n`]*)\n?([\s\S]*?)```/g;

function colourise(text) {
    let result = text;

    // One pass per nesting level, so {bold}{red}x{/red}{/bold} works too.
    for (let pass = 0; pass < 4 && HAS_TAG.test(result); pass++) {
        result = result.replace(TAG_PAIR, (match, name, inner) => `${ESC}[${CODES[name.toLowerCase()]}m${inner}${ESC}[0m`);
    }

    return result.replace(ANY_TAG, "");
}

function formatTags(text) {
    const formatted = text.replace(CODE_BLOCK, (block, language, body) => {
        if (!HAS_TAG.test(body)) return block;
        return "```ansi\n" + colourise(body).replace(/\n$/, "") + "\n```";
    });

    // Tags that ended up outside any code block can't show colour: drop them, keep the text.
    return formatted
        .split(/(```[\s\S]*?```)/g)
        .map((part, index) => (index % 2 === 1 ? part : part.replace(TAG_PAIR, "$2").replace(ANY_TAG, "")))
        .join("");
}

const TAG_BY_CODE = Object.fromEntries(Object.entries(CODES).map(([name, code]) => [code, name]));

/**
 * The reverse of formatTags: shows a coloured ```ansi block as editable
 * {red}..{/red} tags again, so an already posted message can be edited.
 */
function unformatTags(text) {
    return text.replace(/```ansi\n([\s\S]*?)```/g, (block, body) => {
        const open = [];

        const converted = body.replace(new RegExp(`${ESC}\\[(\\d+)m`, "g"), (match, code) => {
            if (code === "0") {
                const name = open.pop();
                return name ? `{/${name}}` : "";
            }
            const name = TAG_BY_CODE[code];
            if (!name) return "";
            open.push(name);
            return `{${name}}`;
        });

        const unclosed = open.reverse().map(name => `{/${name}}`).join("");
        return "```\n" + converted.replace(/\n$/, "") + unclosed + "\n```";
    });
}

module.exports = { formatTags, unformatTags };
