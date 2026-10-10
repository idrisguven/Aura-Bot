const { createApplicationFeature } = require("./applications.js");

// The message box opens with this text so the announcement looks like a full
// application panel. {red}...{/red} turns red inside the code block; it is all
// editable before posting.
const PANEL_TEMPLATE = `\`\`\`
1. Use this panel to apply as a member of the Aura2 team.
2. Team members help keep the server friendly, safe and active.
3. Before applying, make sure you can dedicate regular time to the server.
4. Create a {red}team application ticket{/red} by selecting this category from the menu.
5. Tell us which position you are applying for.
6. Describe your experience, your availability and why you want to join.
7. Inactive members or low-effort applications will not be accepted.
8. Misuse of a team role or false information may result in immediate disqualification.

⚠️ {red}Important Notice{/red}
Team status does not give you any rights outside of your duties.
All team members must follow the Aura2 rules and guidelines.
\`\`\`
## Tickets that don't fit the category or follow the form WILL BE DIRECTLY DELETED
-# Do not create multiple tickets for the same application.`;

module.exports = createApplicationFeature({
    kind: "team",
    displayName: "Team",
    commandName: "teamapplication",
    statusCommandName: "teamapplication-status",
    formPrefix: "teamapplication_form_",
    commandDescription: "Posts a team application panel with a button that opens an application ticket.",
    statusDescription: "Opens or closes team applications (while closed, the button shows a notice).",
    modalTitle: "Team Application Panel",
    defaultTitle: "Team Application Panel",
    defaultButtonLabel: "Apply to the team",
    buttonEmoji: "👥",
    messagePlaceholder: "Describe how people can apply...",
    messageTemplate: PANEL_TEMPLATE
});
