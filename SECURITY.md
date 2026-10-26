# Security policy

## The short version

This plugin is read-only and has no credentials of its own. It does not ask
for API keys, it does not read the Harness credentials, it does not talk to
any third-party server, and it never writes to your workspace. Its whole
surface is: the session data the Harness already gives the page, and the one
line it adds to your profile's patch file.

| What | Where it lives | How to change it |
| --- | --- | --- |
| plugin bundle row | `<profile>/cordis.patch.yml` | remove the `agent-team-board` entry |
| avatar choices | the browser's `localStorage`, key `dsh.agent-team-board.avatars` | clear the site data |

There is no token to rotate, because no token is issued.

## What the plugin can reach

* **The session store.** The board reads the Lead session's `agentTeam`
  projection and each member's own `todos`, `tokenUsage`, `sessionStats` and
  `modelSelection` projections. These are the same values the Harness already
  renders in its own Agent Teams panel.
* **The member session logs.** To list the files a member actually wrote, the
  board reads that member's own conversation log and picks out the `write`,
  `edit` and `present` tool calls. It reads the log to list paths; it never
  opens, modifies or deletes the files themselves.
* **The browser tab.** The client half renders the board and opens a member's
  conversation or a file in the Harness sidebar, using the Harness's own
  navigation services.
* **Your workspace path.** The board knows the directory a member worked in,
  so it can show its artifacts relative to that directory.

## What it does not do

* **No writes.** The board is read-only. It creates no task, changes no task,
  and writes no file — not in the workspace, not in the session.
* **No outbound network calls.** Every number and label is rendered locally
  in the browser.
* **No telemetry, no analytics, no crash reporting.**
* **No reading of `~/.dsh/credentials.yaml` or any other credential store.**
* **No background processes, no scheduled tasks, no daemons.**
* **No Team RPC.** It never asks the team to do anything; it only watches the
  projections the host already keeps current.

## Bundled third-party code

The shipped `plugin/client.js` inlines **no** third-party library. React is
marked external and is loaded from the Harness shell's own module table, so
the plugin never ships a second copy of it. The preview harness under
`plugin/tools/preview/` does bundle React, which is MIT-licensed; it is a
development tool, it is never installed, and it does not run in the Harness.

## Reporting a problem

Please report security issues privately through GitHub's
[security advisory](https://docs.github.com/en/code-security/security-advisories)
form for this repository rather than opening a public issue.
