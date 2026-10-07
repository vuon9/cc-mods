# cc-mods

Small mods for Claude Code. A mod is a plugin with a hooks module: it can draw a pane or a line above the prompt, and react to what happens in a session. These run in the terminal and in the desktop app.

## Mods

- [skill-map](plugins/skill-map): a side pane listing the skills loaded into the conversation, how big each one is, and how full the context was when it landed. Handy for spotting a big skill that got loaded twice.
- [token-weather](plugins/token-weather): a one-line forecast of the context window above the prompt, with a sparkline of the last 12 turns and a guess at how the session is going for you.

## Install

Add the marketplace once, then install the mods you want:

```bash
claude plugin marketplace add vuon9/cc-mods
claude plugin install skill-map@cc-mods
claude plugin install token-weather@cc-mods
```

`claude plugin update <name>` pulls the latest version. Each mod's README has the details and its limits.

Built and tested on Claude Code 2.1.288 to 2.1.292.
