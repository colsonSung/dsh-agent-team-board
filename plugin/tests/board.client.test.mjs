/**
 * Smoke test for the Agent Team Board: loads the built browser module the
 * way the shell does, applies it to a mock context, and drives the board in
 * jsdom — the member columns, the status columns, and the member navigation.
 *
 * Run: node --test tests/
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { act } from 'react'

// A real origin is required: localStorage is unavailable on an opaque origin.
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'https://dsh.local/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Node = dom.window.Node
globalThis.Element = dom.window.Element
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/** The Lead Session's `agentTeam` projection, shaped like the Host's view. */
const TEAM = {
  members: [
    { id: 'lead-session', name: 'lead', role: 'lead', phase: 'active' },
    { id: 'reviewer-session', name: 'reviewer', role: 'teammate', phase: 'active' },
    { id: 'qa-session', name: 'qa', role: 'teammate', phase: 'failed', error: 'spawn failed' },
  ],
  tasks: [
    {
      id: 'task-1',
      revision: 1,
      subject: 'Review the pricing copy',
      description: 'Read every page and mark the wrong numbers.',
      status: 'in_progress',
      blockedBy: [],
      writeScopes: ['src/pricing'],
      ownerName: 'reviewer',
      ready: false,
      writeScopeWarnings: [],
    },
    {
      id: 'task-2',
      revision: 1,
      subject: 'Draft the onboarding email',
      description: '',
      status: 'pending',
      blockedBy: ['task-1'],
      writeScopes: [],
      ownerName: undefined,
      ready: false,
      writeScopeWarnings: ['write scopes overlap with task-9'],
    },
    {
      id: 'task-3',
      revision: 1,
      subject: 'Collect the launch checklist',
      description: 'Everything the launch needs.',
      status: 'completed',
      blockedBy: [],
      writeScopes: [],
      ownerName: 'lead',
      ready: false,
      writeScopeWarnings: [],
    },
  ],
}

/** Load the built client bundle through the shell's module-loader facade. */
let loaded
async function loadClientModule() {
  if (loaded !== undefined) return loaded
  let registration
  dom.window.__ModuleLoader__ = { load: (value) => { registration = value } }
  await import('../client.js')
  assert.ok(registration, 'the bundle must register a module factory')
  assert.equal(registration.id, 'dsh-agent-team-board')
  loaded = registration.factory((specifier) => {
    if (specifier === 'react') return React
    throw new Error(`unexpected module request: ${specifier}`)
  })
  return loaded
}

/** A mock client context: slot registry, locale seat, and the navigation services. */
function createContext() {
  const registrations = []
  const opened = []
  const sessions = {
    binding: (sessionId) => ({
      session: { getSnapshot: () => ({ subagent: undefined }) },
    }),
  }
  const uiWorkspace = {
    openSession: (target) => { opened.push(target) },
  }
  const sidebarRight = {
    openResource: (url) => { opened.push(url) },
  }
  const ctx = {
    get: (name) => {
      if (name === 'sessions') return sessions
      if (name === 'uiWorkspace') return uiWorkspace
      if (name === 'sidebarRight') return sidebarRight
      return undefined
    },
    effect: (callback) => callback(),
    locale: {
      bind: () => (key, params) => (params === undefined
        ? key
        : `${key}[${Object.entries(params).map(([name, value]) => `${name}=${value}`).join(',')}]`),
      register: () => () => {},
    },
    slots: {
      inject: (owner, callback) => { registrations.push({ owner }); callback() },
      register: (options, component) => { registrations.push({ options, component }) },
    },
  }
  return { ctx, registrations, opened }
}

/** The standard props the host binds at the View's render position. */
function createProps() {
  const sessionSnapshot = { openState: 'ready', subagent: undefined }
  const sessionsState = {
    phase: 'ready',
    projectionsBySession: {
      'lead-session': {
        values: {
          agentTeam: TEAM,
          subagentCatalog: [
            { id: 'reviewer-session', label: 'Review the onboarding contract and write the delivery package' },
            { id: 'qa-session', label: 'Turn the measured error codes into a merchant playbook' },
          ],
        },
      },
      'reviewer-session': { values: { modelSelection: { next: { model: 'MiniMax-M3.1-Flash' } } } },
    },
    byId: {
      'lead-session': { running: true },
      'reviewer-session': {
        running: true,
        cwd: '/Users/ethansong/Downloads/workspace/onerway-business-systems',
        projectionValues: {
          todos: [
            { content: 'Read the contract and confirm the phase numbers', status: 'completed' },
            { content: 'Write merchant/SKILL.md', status: 'completed' },
            { content: 'Write merchant/README.md', status: 'completed' },
          ],
          titleInput: { first: { text: 'You own one shared task. Write the five onboarding files.' } },
          sessionStats: { turns: 1, steps: 67 },
        },
      },
      'qa-session': { running: false, projectionValues: { sessionStats: { turns: 1, steps: 12 } } },
    },
  }
  const statusMap = new Map([
    ['lead-session', { running: true }],
    ['reviewer-session', { running: true }],
    ['qa-session', { running: false }],
  ])
  return {
    sessionId: 'lead-session',
    useSession: (selector) => selector(sessionSnapshot),
    useSessions: (selector) => selector(sessionsState),
    useSessionStatus: (selector) => selector(statusMap),
    t: (key, params) => (params === undefined
      ? key
      : `${key}[${Object.entries(params).map(([name, value]) => `${name}=${value}`).join(',')}]`),
  }
}

/** Mount the registered board and return its container plus the harness. */
async function mount() {
  const exports = await loadClientModule()
  const harness = createContext()
  exports.apply(harness.ctx)
  const entry = harness.registrations.find((entry) => entry.options?.id === 'agent-team-board')
  assert.ok(entry, 'the board must register into conversation.view')
  assert.equal(entry.options.name, 'conversation.view')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = ReactDOM.createRoot(container)
  await act(async () => {
    root.render(React.createElement(entry.component, createProps()))
  })
  return { harness, container, root, entry }
}

test('registers the board as a Conversation View beside Trajectory', async () => {
  const { harness, root, entry } = await mount()
  assert.equal(entry.options.order, 15, 'the tab must sit right of Trajectory (10)')
  assert.equal(entry.options.locale, 'agentTeamBoard')
  assert.equal(typeof entry.options.label, 'function')
  assert.equal(entry.options.label(), 'view.label')
  await act(async () => { root.unmount() })
})

test('renders one column per member with that member’s tasks', async () => {
  const { container, root } = await mount()
  const columns = container.querySelectorAll('.atb-column')
  // Three members plus the unassigned column that holds task-2.
  assert.equal(columns.length, 4)
  const names = Array.from(container.querySelectorAll('.atb-columnName')).map((node) => node.textContent)
  assert.deepEqual(names, ['lead', 'reviewer', 'qa', 'column.unassigned'])
  const titles = Array.from(container.querySelectorAll('.atb-cardTitle')).map((node) => node.textContent)
  // Cards follow their column: the lead's task, the reviewer's task, then
  // the unassigned task.
  assert.deepEqual(titles, ['Collect the launch checklist', 'Review the pricing copy', 'Draft the onboarding email'])
  await act(async () => { root.unmount() })
})

test('shows the member status and the running activity', async () => {
  const { container, root } = await mount()
  const meta = Array.from(container.querySelectorAll('.atb-memberModel')).map((node) => node.textContent)
  assert.deepEqual(meta, ['memberStatus.running', 'memberStatus.running · MiniMax-M3.1-Flash', 'memberStatus.failed'])
  const dots = Array.from(container.querySelectorAll('.atb-memberButton .atb-dot')).map((node) => node.className)
  assert.deepEqual(dots, ['atb-dot atb-dotRunning', 'atb-dot atb-dotRunning', 'atb-dot atb-dotFailed'])
  await act(async () => { root.unmount() })
})

test('switches to the status layout on request', async () => {
  const { container, root } = await mount()
  const buttons = Array.from(container.querySelectorAll('.atb-layoutButton'))
  assert.deepEqual(buttons.map((button) => button.textContent), ['layout.member', 'layout.status'])
  await act(async () => { buttons[1].click() })
  const names = Array.from(container.querySelectorAll('.atb-columnName')).map((node) => node.textContent)
  assert.deepEqual(names, ['status.pending', 'status.in_progress', 'status.completed'])
  await act(async () => { root.unmount() })
})

test('the status layout keeps the members’ own work in view', async () => {
  const { container, root } = await mount()
  const buttons = Array.from(container.querySelectorAll('.atb-layoutButton'))
  await act(async () => { buttons[1].click() })
  const columns = Array.from(container.querySelectorAll('.atb-column'))
  // The reviewer's three finished steps are in the completed column, so the
  // status view shows the same work the member view shows.
  const done = columns[2].querySelectorAll('.atb-step')
  assert.deepEqual(Array.from(done).map((node) => node.textContent), [
    'Read the contract and confirm the phase numbers',
    'Write merchant/SKILL.md',
    'Write merchant/README.md',
  ])
  // Each row carries the owner's avatar, and clicking it opens that member.
  assert.equal(done[0].querySelector('.atb-stepOwner') !== null, true)
  await act(async () => { done[0].querySelector('.atb-stepOwner').click() })
  assert.ok(container.querySelector('.atb-panel'), 'the owner avatar opens the member panel')
  await act(async () => { root.unmount() })
})

test('keeps the roster reachable in every layout', async () => {
  const { container, root } = await mount()
  const buttons = Array.from(container.querySelectorAll('.atb-layoutButton'))
  // The roster strip stays in the member layout.
  const roster = container.querySelector('.atb-roster')
  assert.ok(roster, 'the roster must be on screen')
  assert.equal(roster.querySelectorAll('.atb-rosterButton').length, 3)
  // It survives the switch to the status layout, where no member column is
  // rendered and the panel would otherwise be unreachable.
  await act(async () => { buttons[1].click() })
  const after = container.querySelector('.atb-roster')
  assert.ok(after, 'the roster must survive the status layout')
  const member = after.querySelectorAll('.atb-rosterButton')[1]
  await act(async () => { member.click() })
  assert.ok(container.querySelector('.atb-panel'), 'the roster opens the member panel')
  await act(async () => { root.unmount() })
})

test('says plainly that a team without shared tasks has none', async () => {
  const exports = await loadClientModule()
  const harness = createContext()
  exports.apply(harness.ctx)
  const entry = harness.registrations.find((entry) => entry.options?.id === 'agent-team-board')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = ReactDOM.createRoot(container)
  const props = createProps()
  props.useSessions = (selector) => selector({
    phase: 'ready',
    projectionsBySession: { 'lead-session': { values: { agentTeam: { ...TEAM, tasks: [] } } } },
    byId: { 'lead-session': { running: true } },
  })
  await act(async () => { root.render(React.createElement(entry.component, props)) })
  const buttons = Array.from(container.querySelectorAll('.atb-layoutButton'))
  await act(async () => { buttons[1].click() })
  assert.ok(container.textContent.includes('board.noSharedTasks'))
  assert.ok(container.textContent.includes('status.empty.pending'))
  await act(async () => { root.unmount() })
})

test('clamps the task description before measuring it', async () => {
  const { container, root } = await mount()
  // The clamp must be on while the overflow is measured: an unclamped
  // paragraph reports no overflow, so the toggle would never appear.
  const descriptions = Array.from(container.querySelectorAll('.atb-desc'))
  assert.ok(descriptions.length > 0)
  for (const paragraph of descriptions) {
    assert.ok(paragraph.className.includes('atb-descClamp'), 'a description must be clamped before it is measured')
  }
  await act(async () => { root.unmount() })
})

test('lists the member’s own task list in its column', async () => {
  const { container, root } = await mount()
  const columns = Array.from(container.querySelectorAll('.atb-column'))
  // The reviewer's column carries its own task list, not a bare note.
  const steps = Array.from(columns[1].querySelectorAll('.atb-step')).map((node) => node.textContent)
  assert.deepEqual(steps, [
    'Read the contract and confirm the phase numbers',
    'Write merchant/SKILL.md',
    'Write merchant/README.md',
  ])
  // The work sits in the group of its own status: the shared task in
  // progress first, then the member's finished steps.
  const groups = Array.from(columns[1].querySelectorAll('.atb-group'))
  assert.deepEqual(groups.map((group) => group.querySelector('.atb-groupTitle').textContent), [
    'status.in_progress1',
    'status.completed3',
  ])
  // A member without a task list says so.
  assert.ok(columns[2].textContent.includes('column.noTasks'))
  await act(async () => { root.unmount() })
})

test('breaks a member column down by status', async () => {
  const exports = await loadClientModule()
  const harness = createContext()
  exports.apply(harness.ctx)
  const entry = harness.registrations.find((entry) => entry.options?.id === 'agent-team-board')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = ReactDOM.createRoot(container)
  const props = createProps()
  // The reviewer carries work in every bucket: one shared task in progress,
  // and one step each that is pending, in progress and done.
  props.useSessions = (selector) => selector({
    phase: 'ready',
    projectionsBySession: {
      'lead-session': { values: { agentTeam: TEAM, subagentCatalog: [] } },
    },
    byId: {
      'lead-session': { running: true },
      'reviewer-session': {
        running: true,
        projectionValues: {
          todos: [
            { content: 'Confirm the launch date', status: 'pending' },
            { content: 'Write the rollout note', status: 'in_progress' },
            { content: 'Read the contract', status: 'completed' },
          ],
        },
      },
      'qa-session': { running: false },
    },
  })
  await act(async () => { root.render(React.createElement(entry.component, props)) })
  const reviewer = container.querySelectorAll('.atb-column')[1]
  // All three counts are on the column, so an empty bucket is visible too.
  const pills = Array.from(reviewer.querySelectorAll('.atb-statPill')).map((node) => node.textContent)
  assert.deepEqual(pills, ['status.pending1', 'status.in_progress2', 'status.completed1'])
  // The groups follow the same order and carry both kinds of work: the
  // member's own steps and the shared tasks it owns.
  const groups = Array.from(reviewer.querySelectorAll('.atb-group')).map((group) => ({
    title: group.querySelector('.atb-groupTitle').textContent,
    count: group.querySelector('.atb-groupCount').textContent,
    steps: Array.from(group.querySelectorAll('.atb-step')).map((node) => node.textContent),
    cards: Array.from(group.querySelectorAll('.atb-cardTitle')).map((node) => node.textContent),
  }))
  assert.deepEqual(groups, [
    { title: 'status.pending1', count: '1', steps: ['Confirm the launch date'], cards: [] },
    { title: 'status.in_progress2', count: '2', steps: ['Write the rollout note'], cards: ['Review the pricing copy'] },
    { title: 'status.completed1', count: '1', steps: ['Read the contract'], cards: [] },
  ])
  await act(async () => { root.unmount() })
})

test('lists the files a member produced', async () => {
  const exports = await loadClientModule()
  const harness = createContext()
  // The sessions service also carries the journal the artifacts are read
  // from: the host pages a member's own event log.
  const originalGet = harness.ctx.get
  harness.ctx.get = (name) => {
    if (name !== 'sessions') return originalGet(name)
    return {
      binding: (sessionId) => ({ session: { getSnapshot: () => ({ subagent: undefined }) } }),
      subagentAddress: (sessionId) => ({ parentSessionId: 'lead-session', childSessionId: sessionId, mode: 'continuable' }),
      manager: {
        remote: {
          session: {
            page: async () => ({
              ok: true,
              value: {
                records: [
                  { event: { type: 'tool/call', seq: 10, data: { name: 'write', arguments: JSON.stringify({ file_path: '/work/src/lib/a.js' }) } } },
                  { event: { type: 'tool/call', seq: 11, data: { name: 'edit', arguments: JSON.stringify({ file_path: '/work/src/lib/b.js' }) } } },
                  { event: { type: 'tool/call', seq: 12, data: { name: 'read', arguments: JSON.stringify({ file_path: '/work/src/lib/c.js' }) } } },
                  { event: { type: 'tool/call', seq: 13, data: { name: 'present', arguments: JSON.stringify({ files: [{ path: '/work/out/report.md' }] }) } } },
                ],
              },
            }),
          },
        },
      },
    }
  }
  exports.apply(harness.ctx)
  const entry = harness.registrations.find((entry) => entry.options?.id === 'agent-team-board')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = ReactDOM.createRoot(container)
  const props = createProps()
  props.useSessions = (selector) => selector({
    phase: 'ready',
    projectionsBySession: { 'lead-session': { values: { agentTeam: TEAM, subagentCatalog: [] } } },
    byId: {
      'lead-session': { running: true },
      'reviewer-session': {
        running: true,
        cwd: '/work',
        projectionValues: {
          todos: [{ content: 'Read the contract', status: 'completed' }],
          turnBoundary: { lastStepBoundary: { kind: 'end', seq: 20 } },
        },
      },
      'qa-session': { running: false },
    },
  })
  await act(async () => { root.render(React.createElement(entry.component, props)) })
  await act(async () => { container.querySelectorAll('.atb-avatarButton')[1].click() })
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 20); }) })
  const panel = container.querySelector('.atb-panel')
  assert.ok(panel, 'the member panel must open')
  // Only the files that were produced count: the read is not an artifact.
  const section = Array.from(panel.querySelectorAll('.atb-section'))
    .find((node) => node.textContent.includes('panel.artifacts'))
  assert.ok(section, 'the panel must carry an artifacts section')
  const files = Array.from(section.querySelectorAll('.atb-file')).map((node) => node.textContent)
  assert.deepEqual(files, ['src/lib/a.js', 'src/lib/b.js', 'out/report.md'])
  // The paths are relative to the directory the member worked in.
  assert.ok(section.textContent.includes('panel.artifacts · 3'))
  // Clicking one opens it in the sidebar.
  await act(async () => { section.querySelectorAll('.atb-file')[0].click() })
  assert.deepEqual(harness.opened, [
    'dsh-resource://file/session/reviewer-session/src/lib/a.js',
  ])
  await act(async () => { root.unmount() })
})

test('reports the blocked task and the write-scope warning', async () => {
  const { container, root } = await mount()
  const cards = Array.from(container.querySelectorAll('.atb-card'))
  const blocked = cards.find((card) => card.textContent.includes('Draft the onboarding email'))
  assert.ok(blocked.textContent.includes('task.blocked'))
  assert.ok(blocked.textContent.includes('task.blockedBy:task-1'))
  assert.ok(blocked.textContent.includes('write scopes overlap with task-9'))
  await act(async () => { root.unmount() })
})

test('shows what a member’s work cost in tokens', async () => {
  const exports = await loadClientModule()
  const harness = createContext()
  exports.apply(harness.ctx)
  const entry = harness.registrations.find((entry) => entry.options?.id === 'agent-team-board')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = ReactDOM.createRoot(container)
  const props = createProps()
  props.useSessions = (selector) => selector({
    phase: 'ready',
    projectionsBySession: {
      'lead-session': { values: { agentTeam: TEAM, subagentCatalog: [] } },
    },
    byId: {
      'lead-session': {
        running: true,
        projectionValues: {
          tokenUsage: { uncachedInputTokens: 1000, outputTokens: 500, cacheReadTokens: 250000000, cacheWriteTokens: 0 },
          sessionStats: { turns: 26, steps: 1019, llmMs: 1000, toolMs: 0 },
        },
      },
      'reviewer-session': {
        running: true,
        projectionValues: {
          todos: [{ content: 'Read the contract', status: 'completed' }],
          // The same buckets the host counts, so the number matches the one
          // in the host's own subagent list.
          tokenUsage: { uncachedInputTokens: 534696, outputTokens: 35244, cacheReadTokens: 14937472, cacheWriteTokens: 0 },
          sessionStats: { turns: 1, steps: 81, llmMs: 360811, toolMs: 17971 },
        },
      },
      'qa-session': { running: false },
    },
  })
  await act(async () => { root.render(React.createElement(entry.component, props)) })
  const columns = container.querySelectorAll('.atb-column')
  // Each member carries its own cost.
  assert.equal(columns[1].querySelector('.atb-columnCost').textContent, 'column.cost[tokens=15.5M,duration=6m 19s]')
  assert.equal(columns[0].querySelector('.atb-columnCost').textContent, 'column.cost[tokens=250M,duration=1s]')
  // A member that never ran carries no number.
  assert.equal(columns[2].querySelector('.atb-columnCost'), null)
  // The summary bar totals the roster.
  assert.ok(container.querySelector('.atb-stats').textContent.includes('summary.tokens[count=265.5M]'))
  // The panel breaks the same number down into its buckets.
  await act(async () => { container.querySelectorAll('.atb-avatarButton')[1].click() })
  const panel = container.querySelector('.atb-panel')
  assert.ok(panel.textContent.includes('panel.tokens.total[count=15.5M]'))
  assert.ok(panel.textContent.includes('panel.tokens.input 534.7K'))
  assert.ok(panel.textContent.includes('panel.tokens.output 35.2K'))
  assert.ok(panel.textContent.includes('panel.tokens.cache 14.9M'))
  assert.ok(panel.textContent.includes('panel.tokens.cacheHit[percent=96]'))
  await act(async () => { root.unmount() })
})

test('opens a member conversation from the column header', async () => {
  const { harness, container, root } = await mount()
  const headers = Array.from(container.querySelectorAll('.atb-memberButton'))
  await act(async () => { headers[1].click() })
  assert.deepEqual(harness.opened, [
    { parentSessionId: 'lead-session', childSessionId: 'reviewer-session', mode: 'continuable' },
  ])
  await act(async () => { root.unmount() })
})

test('states the duty and the result count on the column itself', async () => {
  const { container, root } = await mount()
  try {
    const columns = Array.from(container.querySelectorAll('.atb-column'))
    // The lead is not in the catalog, so it carries a duty of its own.
    assert.equal(columns[0].querySelector('.atb-columnDuty').textContent, 'role.lead.duty[count=3]')
    // The reviewer has both a duty and three completed steps.
    const reviewer = columns[1]
    assert.equal(reviewer.querySelector('.atb-columnDuty').textContent, 'Review the onboarding contract and write the delivery package')
    // The result count is now the member's own status breakdown: one shared
    // task in progress and three finished steps.
    const pills = Array.from(reviewer.querySelectorAll('.atb-statPill')).map((node) => node.textContent)
    assert.deepEqual(pills, ['status.pending0', 'status.in_progress1', 'status.completed3'])
    // A column without shared tasks says so instead of showing a bare dash.
    assert.ok(columns[2].textContent.includes('column.noTasks'))
  } finally {
    // The root must always go away: a mounted jsdom keeps the event loop
    // alive, and a failed assertion would hang the whole file.
    await act(async () => { root.unmount() })
  }
})

test('draws one avatar per member', async () => {
  const { container, root } = await mount()
  const avatars = Array.from(container.querySelectorAll('.atb-column .atb-avatar'))
  assert.equal(avatars.length, 3, 'every member column carries an avatar')
  const buttons = Array.from(container.querySelectorAll('.atb-avatarButton'))
  assert.equal(buttons.length, 3, 'every avatar opens the member panel')
  await act(async () => { root.unmount() })
})

test('shows the duty, the tasks and the results of the inspected member', async () => {
  const { container, root } = await mount()
  const buttons = Array.from(container.querySelectorAll('.atb-avatarButton'))
  await act(async () => { buttons[1].click() })
  const panel = container.querySelector('.atb-panel')
  assert.ok(panel, 'the member panel must open')
  // The responsibility comes from the Lead's subagent catalog.
  assert.ok(panel.textContent.includes('Review the onboarding contract and write the delivery package'))
  // The results are the member's own completed steps.
  const steps = Array.from(panel.querySelectorAll('.atb-step')).map((node) => node.textContent)
  assert.deepEqual(steps, [
    'Read the contract and confirm the phase numbers',
    'Write merchant/SKILL.md',
    'Write merchant/README.md',
  ])
  // The member's own task is listed, and its file is offered.
  assert.ok(panel.textContent.includes('Review the pricing copy'))
  const files = Array.from(panel.querySelectorAll('.atb-file')).map((node) => node.textContent)
  assert.deepEqual(files, ['src/pricing'])
  await act(async () => { root.unmount() })
})

test('opens a member file through the sidebar', async () => {
  const { harness, container, root } = await mount()
  const buttons = Array.from(container.querySelectorAll('.atb-avatarButton'))
  await act(async () => { buttons[1].click() })
  const file = container.querySelector('.atb-file')
  await act(async () => { file.click() })
  assert.deepEqual(harness.opened, [
    'dsh-resource://file/session/reviewer-session/src/pricing',
  ])
  await act(async () => { root.unmount() })
})

test('pins a different avatar and keeps it', async () => {
  window.localStorage.clear()
  const { container, root } = await mount()
  const buttons = Array.from(container.querySelectorAll('.atb-avatarButton'))
  await act(async () => { buttons[1].click() })
  const picker = Array.from(container.querySelectorAll('.atb-pickerButton'))
  assert.ok(picker.length > 1, 'the panel must offer a glyph to choose')
  // The second column is the reviewer, the member the panel is open for.
  const column = () => container.querySelectorAll('.atb-column')[1]
  const before = column().querySelector('.atb-avatar svg').innerHTML
  await act(async () => { picker[1].click() })
  const stored = JSON.parse(window.localStorage.getItem('dsh.agent-team-board.avatars') ?? '{}')
  assert.ok(typeof stored.reviewer === 'string', 'the chosen glyph must be stored')
  const after = column().querySelector('.atb-avatar svg').innerHTML
  assert.notEqual(after, before, 'the member avatar must change')
  await act(async () => { root.unmount() })
})

test('marks a column that carries work in progress with a halo', async () => {
  const { container, root } = await mount()
  try {
    const columns = Array.from(container.querySelectorAll('.atb-column'))
    // The reviewer owns the shared task that is in progress, so its column
    // wears the halo.
    assert.equal(columns[1].classList.contains('atb-columnActive'), true)
    // The lead's own work is done, the qa member failed and the unassigned
    // task is only pending: none of them carries work in progress.
    assert.equal(columns[0].classList.contains('atb-columnActive'), false)
    assert.equal(columns[2].classList.contains('atb-columnActive'), false)
    assert.equal(columns[3].classList.contains('atb-columnActive'), false)
  } finally {
    await act(async () => { root.unmount() })
  }
})

test('marks a member whose own step is in progress with a halo', async () => {
  const exports = await loadClientModule()
  const harness = createContext()
  exports.apply(harness.ctx)
  const entry = harness.registrations.find((entry) => entry.options?.id === 'agent-team-board')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = ReactDOM.createRoot(container)
  const props = createProps()
  // The qa member owns no shared task, but one of its own steps is in
  // progress: that is work in progress too.
  props.useSessions = (selector) => selector({
    phase: 'ready',
    projectionsBySession: { 'lead-session': { values: { agentTeam: TEAM, subagentCatalog: [] } } },
    byId: {
      'lead-session': { running: true },
      'reviewer-session': { running: false, projectionValues: { todos: [] } },
      'qa-session': {
        running: true,
        projectionValues: { todos: [{ content: 'Recover the failed spawn', status: 'in_progress' }] },
      },
    },
  })
  await act(async () => { root.render(React.createElement(entry.component, props)) })
  const columns = Array.from(container.querySelectorAll('.atb-column'))
  assert.equal(columns[2].classList.contains('atb-columnActive'), true)
  await act(async () => { root.unmount() })
})

test('marks only the in-progress column of the status layout with a halo', async () => {
  const { container, root } = await mount()
  try {
    const buttons = Array.from(container.querySelectorAll('.atb-layoutButton'))
    await act(async () => { buttons[1].click() })
    const columns = Array.from(container.querySelectorAll('.atb-column'))
    assert.equal(columns[1].classList.contains('atb-columnActive'), true)
    assert.equal(columns[0].classList.contains('atb-columnActive'), false)
    assert.equal(columns[2].classList.contains('atb-columnActive'), false)
  } finally {
    await act(async () => { root.unmount() })
  }
})

test('shows a notice when the session has no team', async () => {
  const exports = await loadClientModule()
  const harness = createContext()
  exports.apply(harness.ctx)
  const entry = harness.registrations.find((entry) => entry.options?.id === 'agent-team-board')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = ReactDOM.createRoot(container)
  const props = createProps()
  props.useSessions = (selector) => selector({ phase: 'ready', projectionsBySession: {}, byId: {} })
  await act(async () => { root.render(React.createElement(entry.component, props)) })
  assert.ok(container.textContent.includes('board.unavailable'))
  assert.ok(container.textContent.includes('board.hint'))
  await act(async () => { root.unmount() })
})

test('survives a member whose projections carry null values', async () => {
  const exports = await loadClientModule()
  const harness = createContext()
  exports.apply(harness.ctx)
  const entry = harness.registrations.find((entry) => entry.options?.id === 'agent-team-board')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = ReactDOM.createRoot(container)
  const props = createProps()
  // A projection row can carry a null value instead of an absent one, so the
  // panel must not read a length off it.
  props.useSessions = (selector) => selector({
    phase: 'ready',
    projectionsBySession: {
      'lead-session': {
        values: {
          agentTeam: TEAM,
          subagentCatalog: [{ id: 'reviewer-session', label: null }],
        },
      },
    },
    byId: {
      'lead-session': { running: true },
      'reviewer-session': { running: false, projectionValues: { todos: null, sessionStats: null } },
      'qa-session': { running: false },
    },
  })
  await act(async () => { root.render(React.createElement(entry.component, props)) })
  const avatars = Array.from(container.querySelectorAll('.atb-avatarButton'))
  await act(async () => { avatars[1].click() })
  const panel = container.querySelector('.atb-panel')
  assert.ok(panel, 'the panel must open even when the projections are empty')
  assert.ok(panel.textContent.includes('panel.dutyMissing'))
  assert.ok(panel.textContent.includes('panel.results.missing'))
  await act(async () => { root.unmount() })
})

/**
 * Mount the board with a given session store and a stubbed Host route.
 *
 * The board reads one Session's complete task record from the Host, so the
 * tests answer that route themselves instead of touching the network.
 * @param {object} state - the session store the board reads.
 * @param {Map<string, Array<object>>} histories - the record per Session id.
 * @param {string} sessionId - the Session the board is shown in.
 * @returns {Promise<object>} the container plus the root.
 */
async function mountWith(state, histories, sessionId) {
  const exports = await loadClientModule()
  const harness = createContext()
  exports.apply(harness.ctx)
  const entry = harness.registrations.find((entry) => entry.options?.id === 'agent-team-board')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = ReactDOM.createRoot(container)
  const previous = globalThis.fetch
  globalThis.fetch = async (url) => {
    const asked = new URL(String(url), 'https://dsh.local/').searchParams.get('sessionId')
    const items = histories.get(asked) ?? []
    return { ok: true, status: 200, json: async () => ({ sessionId: asked, items }) }
  }
  try {
    const props = createProps()
    props.sessionId = sessionId
    props.useSessions = (selector) => selector(state)
    await act(async () => { root.render(React.createElement(entry.component, props)) })
    // Let the Host route answer and the board redraw with the record.
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0) }) })
  } finally {
    globalThis.fetch = previous
  }
  return { container, root }
}

test('shows the complete record of a member whose current round is empty', async () => {
  const { container, root } = await mountWith(
    {
      phase: 'ready',
      projectionsBySession: { 'history-lead': { values: { agentTeam: { members: [{ id: 'history-lead', name: 'lead', role: 'lead', phase: 'active' }], tasks: [] } } } },
      byId: { 'history-lead': { running: true } },
    },
    new Map([
      ['history-lead', [
        { content: 'Design the protocol frame', status: 'completed', seq: 30 },
        { content: 'Wire the host side', status: 'completed', seq: 40 },
        { content: 'Verify end to end', status: 'in_progress', seq: 50 },
      ]],
    ]),
    'history-lead',
  )
  try {
    const column = container.querySelector('.atb-column')
    const steps = Array.from(column.querySelectorAll('.atb-step')).map((node) => node.textContent)
    // The record of the earlier rounds is on screen even though the running
    // round's own projection carries nothing.
    assert.deepEqual(steps, ['Verify end to end', 'Wire the host side', 'Design the protocol frame'])
    const counts = Array.from(column.querySelectorAll('.atb-columnStats .atb-statCount')).map((node) => node.textContent)
    assert.deepEqual(counts, ['0', '1', '2'], 'the counts cover the whole record')
    assert.ok(column.textContent.includes('column.earlier'), 'the column says how much came from earlier rounds')
  } finally {
    await act(async () => { root.unmount() })
  }
})

test('folds a long record behind a toggle', async () => {
  const items = Array.from({ length: 12 }, (unused, index) => ({
    content: `Step ${index}`,
    status: 'completed',
    seq: 100 - index,
  }))
  const { container, root } = await mountWith(
    {
      phase: 'ready',
      projectionsBySession: { 'fold-lead': { values: { agentTeam: { members: [{ id: 'fold-lead', name: 'lead', role: 'lead', phase: 'active' }], tasks: [] } } } },
      byId: { 'fold-lead': { running: true } },
    },
    new Map([['fold-lead', items]]),
    'fold-lead',
  )
  try {
    const column = container.querySelector('.atb-column')
    assert.equal(column.querySelectorAll('.atb-step').length, 8, 'only the newest entries stay on screen')
    const fold = column.querySelector('.atb-fold')
    assert.ok(fold, 'the folded entries need a way out')
    assert.ok(fold.textContent.includes('count=4'), 'the toggle says how many are folded')
    await act(async () => { fold.click() })
    assert.equal(column.querySelectorAll('.atb-step').length, 12, 'the whole record is one click away')
    assert.ok(column.querySelector('.atb-fold').textContent.includes('column.less'))
  } finally {
    await act(async () => { root.unmount() })
  }
})

test('the running round decides the status of an item the history also holds', async () => {
  const { container, root } = await mountWith(
    {
      phase: 'ready',
      projectionsBySession: { 'both-lead': { values: { agentTeam: { members: [{ id: 'both-lead', name: 'lead', role: 'lead', phase: 'active' }], tasks: [] } } } },
      byId: {
        'both-lead': {
          running: true,
          projectionValues: { todos: [{ content: 'Ship the release', status: 'in_progress' }] },
        },
      },
    },
    new Map([['both-lead', [{ content: 'Ship the release', status: 'completed', seq: 10 }]]]),
    'both-lead',
  )
  try {
    const column = container.querySelector('.atb-column')
    const steps = Array.from(column.querySelectorAll('.atb-step'))
    assert.equal(steps.length, 1, 'the item is counted once')
    // The running round says it is still in progress, so it is not done.
    assert.ok(steps[0].className.includes('atb-stepPending'))
    const counts = Array.from(column.querySelectorAll('.atb-columnStats .atb-statCount')).map((node) => node.textContent)
    assert.deepEqual(counts, ['0', '1', '0'])
  } finally {
    await act(async () => { root.unmount() })
  }
})

test('keeps the board usable when the record cannot be read', async () => {
  const exports = await loadClientModule()
  const harness = createContext()
  exports.apply(harness.ctx)
  const entry = harness.registrations.find((entry) => entry.options?.id === 'agent-team-board')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = ReactDOM.createRoot(container)
  const previous = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('the host is away') }
  try {
    const props = createProps()
    props.useSessions = (selector) => selector({
      phase: 'ready',
      projectionsBySession: { 'lead-session': { values: { agentTeam: TEAM } } },
      byId: { 'lead-session': { running: true } },
    })
    await act(async () => { root.render(React.createElement(entry.component, props)) })
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0) }) })
    // The board still shows what the projection holds and says the rest could
    // not be read.
    assert.ok(container.querySelector('.atb-column'), 'the board still renders')
    assert.ok(container.textContent.includes('column.historyFailed'))
  } finally {
    globalThis.fetch = previous
    await act(async () => { root.unmount() })
  }
})

test('marks every status with a drawn icon, not a font glyph', async () => {
  const { container, root } = await mountWith(
    {
      phase: 'ready',
      projectionsBySession: { 'icon-lead': { values: { agentTeam: { members: [{ id: 'icon-lead', name: 'lead', role: 'lead', phase: 'active' }], tasks: [] } } } },
      byId: {
        'icon-lead': {
          running: true,
          projectionValues: {
            todos: [
              { content: 'Not started yet', status: 'pending' },
              { content: 'Being worked on', status: 'in_progress' },
              { content: 'Already done', status: 'completed' },
            ],
          },
        },
      },
    },
    new Map(),
    'icon-lead',
  )
  try {
    const column = container.querySelector('.atb-column')
    const marks = Array.from(column.querySelectorAll('.atb-step .atb-stepMark'))
    assert.equal(marks.length, 3, 'every row carries a mark')
    // The mark is drawn, so it does not depend on the platform's font.
    for (const mark of marks) {
      assert.equal(mark.tagName.toLowerCase(), 'svg', 'the mark is an inline icon')
      assert.equal(mark.getAttribute('aria-hidden'), 'true', 'the mark is decoration')
    }
    const classes = marks.map((mark) => mark.getAttribute('class'))
    assert.deepEqual(classes, [
      'atb-stepMark atb-markPending',
      'atb-stepMark atb-markProgress',
      'atb-stepMark atb-markDone',
    ])
    // The icon carries no text, so the row's text stays the item's own words.
    assert.deepEqual(
      Array.from(column.querySelectorAll('.atb-step')).map((node) => node.textContent),
      ['Not started yet', 'Being worked on', 'Already done'],
    )
  } finally {
    await act(async () => { root.unmount() })
  }
})

test('shows the same icon inside a shared task’s status pill', async () => {
  const { container, root } = await mount()
  try {
    const pills = Array.from(container.querySelectorAll('.atb-pill'))
    const withIcon = pills.filter((pill) => pill.querySelector('.atb-stepMark'))
    assert.ok(withIcon.length > 0, 'a status pill carries its icon')
    assert.ok(
      withIcon.every((pill) => pill.querySelector('svg') !== null),
      'the pill icon is drawn, not typed',
    )
  } finally {
    await act(async () => { root.unmount() })
  }
})
