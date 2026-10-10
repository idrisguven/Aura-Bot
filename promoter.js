const { createApplicationFeature } = require("./applications.js");

module.exports = createApplicationFeature({
    kind: "promoter",
    displayName: "Promoter",
    commandName: "promoter",
    statusCommandName: "promoter-applications",
    formPrefix: "promoter_form_",
    commandDescription: "Posts a promoter announcement with a button that opens an application ticket.",
    statusDescription: "Opens or closes promoter applications (while closed, the button shows a notice).",
    modalTitle: "Promoter Announcement",
    defaultTitle: "Promoter Applications",
    defaultButtonLabel: "Promoter",
    buttonEmoji: "🎥",
    messagePlaceholder: "Please include links to your channel(s), the platform(s) you use..."
});
