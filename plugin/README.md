# Agent Team Board — technical reference

> This file documents the bundle in `plugin/`. For the feature tour and the
> install steps, see the [repository README](../README.md).

A **Team Board** tab for the DeepSeek Harness, placed directly to the right of
**Trajectory** in the conversation header. It shows how an Agent Team is
cooperating right now: one column per teammate, with that teammate's shared
tasks as cards.

![board](../docs/board.png)

## What it shows

| Area | Content |
| --- | --- |
| Summary bar | Member count, task count (both kinds of work), in-progress count, the team's token total, and a layout switch |
| Roster strip | One avatar and name per member, on screen in **both** layouts; clicking an avatar opens that member's panel |
| Member column | Live state (running / idle / provisioning / failed), role, model, **the member's responsibility**, **its work split by status**, and **what its work cost** |
| Lead duty | The Lead is never in the catalog, so it carries a duty of its own — "Leads the team — N members", or "Working on its own" when it is alone |
| Status pills | The member's three counts — pending, in progress, done — always shown, so an empty bucket is visible too |
| Status group | One group per status: the shared tasks the member owns as cards, and the steps it recorded as rows |
| Task card | A shared task: subject, status, readiness, owner, dependencies, touched files, and write-scope conflicts |
| Unassigned column | Tasks nobody has claimed yet |

The second layout groups **the same work** by status (pending / in progress /
done): the shared tasks as full cards, and every member's task items as rows
carrying their owner's avatar. Switching layouts therefore never hides work
that the other layout shows — a team with thirty finished steps and one
shared task shows "Done 30" and "Pending 1" in the status view, not an empty
board.

![status layout](../docs/board-status.png)

**A column is the agent's work, not the shared board.** Each member column
carries the member's work split by status — pending, in progress, done — with
three counts above the list:

* the member's **shared tasks**, as full cards, in the group of their status;
* the member's **own steps**, as rows, in the group of their status.

The first comes from the Lead's `agentTeam` projection. The second comes from
the member's own `todos` projection, so a team that never used the shared task
tools still shows every member's work. A group without work is not rendered:
the counts above it already say it is empty.

The status layout says so outright when there is nothing to group: each
column names its own emptiness ("no pending task"), and the board explains that
this team does not use the shared task board and points back to the member
layout. It never presents three empty columns as if they were a backlog.

The roster strip is what keeps the member panel reachable. The panel is the
only place a member's responsibility and results appear, and the status
layout renders no member column — so without the strip the panel would be
unreachable in half the board.

## Avatars

The Harness has no avatar concept for agents, so the board owns its own:

* Every member gets a glyph chosen from an original eight-glyph set, with a
  colour derived from their name. The same member always looks the same.
* Clicking an avatar opens the member panel, where the glyph can be replaced.
  The choice is stored per member name in the browser's own storage, so it
  survives a reload and follows the member wherever the team appears.
* Clicking the member's *name* opens their conversation instead.

## The member panel

![member panel](../docs/member-panel.png)

Clicking an avatar opens a panel that answers the two questions a team lead
actually asks: *what is this member responsible for*, and *what did they
produce*.

| Section | Source |
| --- | --- |
| Responsibility | The Lead's `subagentCatalog` label — the job description the member was created with |
| Full brief | The member's own assignment brief (`titleInput.first.text`), collapsed by default |
| Tasks | The member's shared tasks from the team projection |
| Token usage | The member's `tokenUsage` projection: the total, the three buckets, the cache hit rate, and the time it spent |
| Artifacts | The files the member actually wrote, read from its own session log; click one to open it in the sidebar |
| Results | The member's own completed steps (`todos`): each file they wrote and each check they ran |
| Files touched | The paths the tasks declare, clickable into the right sidebar |
| Workload | The member's turns and steps (`sessionStats`) |

The panel is read-only. It opens on a click, closes on Escape or a click
outside it, and never performs a Team RPC of its own.

## Artifacts

The shared task board only declares a *scope*; the panel lists what really
landed on disk. The artifacts are read from the member's **own session log** —
every `write`, `edit` and `present` tool call — so they are the files that
exist, not the ones somebody promised to make.

![artifacts](../docs/board-member-artifacts.png)

Each path is relative to the directory the member worked in, and clicking it
opens the file in the right sidebar.

Two things to know about this list:

* It is the member's **whole session**, not one task. The host reports token
  totals per session, and the file list is read the same way.
* A file created by a shell command (`bash`) does not show up. Only the file
  tools are read, because a shell command's output path cannot be known
  without parsing the command.

## Token usage

What a member's work cost is shown next to the work itself: the column
carries `15.5M tok · 6m 19s`, and the panel breaks the number down.

![member tokens](../docs/board-member-tokens.png)

The counters are the host's own, so the board and the host's subagent list
never disagree:

| Number | Source |
| --- | --- |
| Total tokens | `uncachedInput + output + cacheRead + cacheWrite` — the same four buckets the host sums |
| Uncached input | Tokens sent to the model without a cache hit |
| Output | Tokens the model produced |
| Cache read | Tokens read back from the prompt cache |
| Cache hit | `cacheRead / total` |
| Time | `sessionStats.llmMs + sessionStats.toolMs`, the model's own time plus the tools' |

A member that keeps no task list of its own shows no *Results*, but its
**Artifacts** still list every file it wrote — the two sections answer
different questions, and together they cover a member that never used the
todo tool.

One caveat worth knowing: the **Lead's own column is usually the largest**,
because the Lead re-reads the whole conversation on every step. A team total
is therefore mostly the Lead's context, not the team's work.

## How it works

The board registers on the `conversation.view` slot — the same tab row that
carries Chat and Trajectory — with `order: 15`, so it lands to the right of
Trajectory without touching the host shell:

```js
ctx.slots.inject('conversation.view', () => ctx.slots.register({
  name: 'conversation.view',
  id: 'agent-team-board',
  order: 15,
  locale: NS,
  label: () => t('view.label'),
}, (props) => h(TeamBoardView, { ctx, ...props })));
```

Its data comes from the Lead Session's `agentTeam` projection in the shared
Session store (`projectionsBySession[lead].values.agentTeam`). Host projection
frames keep that value current, so the board refreshes itself while a turn runs
and performs **no Team RPC of its own**. The projection carries the roster
(`members`), the shared task board (`tasks`), and the durable-record failure
notice (`failure`).

A teammate conversation reports its Lead through the subagent address, so the
board always reads the Lead's roster:

```js
const leadSessionId = useSession((snapshot) => snapshot.subagent?.address.parentSessionId) ?? sessionId;
const team = useSessions((state) => state.projectionsBySession[leadSessionId]?.values.agentTeam);
```

Clicking a member's name opens that member's conversation through the
`uiWorkspace` service, using the same addressed-subagent path the host's own
Agent Teams panel uses. The member's own records come from the same shared
store: the Lead's `subagentCatalog` carries the responsibility each member was
created with, and the member's own session carries the brief, the completed
steps and the session statistics:

```js
const duty = useSessions((state) => state.projectionsBySession[leadSessionId]?.values.subagentCatalog
  ?.find((child) => child.id === selectedId)?.label);
const steps = useSessions((state) => state.byId[selectedId]?.projectionValues?.todos);
```

Everything else is local: own artwork, own cards, and host theme tokens only.
The plugin imports no other Harness Client package.

## Layout

```
plugin/src/client-entry.js     the browser half: locale, stylesheet, the View and its components
plugin/src/avatars.js          the original glyph set, the colour rule, and the Avatar component
plugin/tests/board.client.test.mjs  jsdom smoke tests over the built bundle
plugin/tools/preview/          a standalone harness that renders the board with mock data
plugin/build.mjs               esbuild → client.js in the shell's module-loader envelope
```

## Build and test

```bash
cd plugin
pnpm install                   # devDependencies only; the plugin has no runtime deps
node build.mjs                 # → client.js
node --test tests/*.mjs        # 21 passing
node tools/preview/build.mjs   # → tools/preview/preview.bundle.js
```

The preview harness renders the board with mock Team data and an approximated
host palette, which makes layout regressions visible without a running
Harness:

```bash
cd plugin/tools/preview
playwright screenshot --channel chrome --viewport-size 1800,520 \
  "file://$PWD/index.html" /tmp/board.png
```

## Install

From a clone of this repository, the installer at the repository root does it:

```bash
./install.sh            # the profile the running Harness uses
./install.sh web        # a named profile
```

It runs `dsh plugin --profile <profile> add ./plugin` and adds the bundle row
to `<profile>/cordis.patch.yml`:

```yaml
- insert:
    - id: agent-team-board
      name: 'dsh-agent-team-board'
```

The plugin is a client bundle, so the Host half is inert. After the profile
recomposes, the tab appears next to Trajectory. Rebuilding `client.js` swaps
the plugin in open pages without a reload; the host watches the bundle
artifact for changes.

## Limitations

* The board shows the **shared task board** and each member's **own todo
  list**, not a session's private scratchpad. A member that called neither
  tool shows no work even when its conversation is full of it.
* The status counts are **record-based**: "in progress" means a task or a step
  carries that status. A member whose session is running but that registered
  no work is shown as running in the column header, not as an in-progress
  item.
* The member panel's *results* are the member's own completed steps — what it
  reported as done. A member that never kept a todo list shows no steps, even
  when its conversation is full of work.
* A member's *files touched* are the paths its tasks declare, not a diff of
  what it wrote.
* The token counts are **cumulative for the session**, not per task. A shared
  task cannot be billed to a member on its own, because the host only reports
  the session's totals.
* The artifacts come from the **file tools**, so a file a shell command
  created is not listed. A member that only ran shell commands shows no
  artifacts.
* Write-scope overlaps are advisory: the host reports them, and the board
  surfaces them, but nothing is blocked.
* The board is read-only. Tasks are created and updated by the team agents
  through their tools.
* Avatar choices live in the browser's own storage, so they follow the
  browser, not the account.
