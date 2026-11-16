# claude-mods

Personal mods (plugins) for Claude Code.

| Mod | What it does |
| --- | --- |
| **switchboard** | `/mods` opens a panel listing every mod with an On/Off button, plus a status line with the count. |
| **input-router** | When a file, email, Drive doc or calendar result is bigger than about 2,000 tokens, Haiku reads it first and hands Claude short notes plus a saved full copy. Skips QuickBooks, and steps aside when a request asks for exact wording. `/router on|off`, `/savings`. |
| **ask-first-guard** | Shows an Allow / Block prompt before Claude sends or forwards email, changes the calendar, RSVPs, or trashes or shares a file. Blocks the action if the prompt can't be shown. |

## Install

In the Claude desktop app (Code tab): click **+** next to the message box, then **Plugins**, **Add marketplace**, enter `Durden800/claude-mods`, then **Add plugin** for each mod.

From a terminal session:

```
/plugin install switchboard --marketplace Durden800/claude-mods
/plugin install input-router --marketplace Durden800/claude-mods
/plugin install ask-first-guard --marketplace Durden800/claude-mods
```

Answer `y` to add the marketplace, then pick the user scope.
