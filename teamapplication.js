const { createApplicationFeature } = require("./applications.js");

module.exports = createApplicationFeature({
    kind: "team",
    displayName: "Team",
    commandName: "teamapplication",
    statusCommandName: "teamapplication-status",
    formPrefix: "teamapplication_form_",
    commandDescription: "Posts a team application announcement with a button that opens an application ticket.",
    statusDescription: "Opens or closes team applications (while closed, the button shows a notice).",
    modalTitle: "Team Application Announcement",
    defaultTitle: "Team Applications",
    defaultButtonLabel: "Apply to the team",
    buttonEmoji: "👥",
    messagePlaceholder: "Tell people which positions are open and what you expect from applicants..."
});
