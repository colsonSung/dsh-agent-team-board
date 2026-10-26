/**
 * Local preview harness for the Agent Team Board.
 *
 * It mounts the real component with a mock client context and the *real*
 * roster of the "远程控制与VPS公网部署" team — the same members, the same
 * duties and the same task records the Harness reads from their session logs.
 *
 * The Lead's own `todos` projection is deliberately empty here, exactly as it
 * is in the application: that projection only carries the round that is
 * running. The record of the earlier rounds comes from the Host route the
 * preview answers itself.
 */
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { apply } from '../../src/client-entry.js';

/** The Lead's record, read from its session log: four rounds of todo writes. */
const LEAD_RECORD = [
  { content: '定义协议层：response_chunk 帧、ws_binary_body 能力、二进制 WS 载荷格式', status: 'completed', seq: 2466 },
  { content: 'Relay 侧：边收边转的流式响应 + 二进制 WS 载荷转发', status: 'completed', seq: 2466 },
  { content: 'Host 侧：流式 HTTP 响应（SSE 不再被 30s 超时掐断）+ 二进制 WS 载荷裸传', status: 'completed', seq: 2466 },
  { content: '契约常量去重：生成器 + 漂移校验测试', status: 'completed', seq: 2466 },
  { content: '额外修复：会话被拒时用 launch token 自愈（手机无需刷新）', status: 'completed', seq: 2466 },
  { content: '全部测试通过 + 真实中继端到端验证 + 重新部署中继', status: 'completed', seq: 2466 },
  { content: '契约常量去重：加机械校验（测试）保证浏览器端与协议文件不漂移', status: 'pending', seq: 1794 },
  { content: '全部测试通过 + 真实中继端到端验证', status: 'pending', seq: 1794 },
  { content: '给出中继重新部署的说明', status: 'in_progress', seq: 1794 },
  { content: 'Add compressed-payload contract to src/relay-protocol.js', status: 'completed', seq: 1593 },
  { content: 'Implement host-side compression + negotiation in src/relay-client.js', status: 'completed', seq: 1593 },
  { content: 'Install the plugin and verify end-to-end through the live relay', status: 'completed', seq: 1593 },
  { content: 'Measure the new click-to-content latency vs the 5.9s baseline', status: 'completed', seq: 1593 },
  { content: 'Implement the phone-side WebSocket shim in client.js', status: 'completed', seq: 1593 },
  { content: 'Write regression tests for the compression path', status: 'completed', seq: 1593 },
  { content: 'Implement the phone-side WebSocket shim in client.js (delegated)', status: 'pending', seq: 830 },
  { content: 'Write regression tests for the compression path (delegated)', status: 'pending', seq: 830 },
];

/** The host-streaming teammate's record: one round, five finished steps. */
const HOST_RECORD = [
  { content: 'Implement streaming event-stream responses in src/relay-client.js (head + chunks + last)', status: 'completed', seq: 473 },
  { content: 'Implement binary WS payload tunnel message behind ws_binary_body capability', status: 'completed', seq: 473 },
  { content: 'Write tests/host-streaming.test.js covering all 5 required cases', status: 'completed', seq: 473 },
  { content: 'Run the full verification suite (6 test files)', status: 'completed', seq: 473 },
  { content: 'Report to the lead: changes, test names, verification, findings', status: 'completed', seq: 473 },
];

/** The record the Host answers with, per Session. */
const RECORDS = new Map([
  ['session-c6966e37-ed74-4b5d-8187-7a6f138e3679', LEAD_RECORD],
  ['08ccf935-3dea-4155-89b1-bfea6ea15a9f', HOST_RECORD],
]);

/** The roster as the Host projects it, with the duty each member was created with. */
const MEMBERS = [
  { id: 'session-c6966e37-ed74-4b5d-8187-7a6f138e3679', name: 'lead', role: 'lead', phase: 'active', running: true, duty: null },
  {
    id: 'c5dfa33c-f1a8-4032-a5ec-c520b1d99202',
    name: 'phone-shim',
    role: 'teammate',
    phase: 'active',
    running: false,
    duty: 'Implement the phone-side WebSocket decompression shim in the remote-control plugin client.js',
  },
  {
    id: 'c0a4a571-81f7-4406-b044-658136c7654b',
    name: 'compression-tests',
    role: 'teammate',
    phase: 'active',
    running: false,
    duty: 'Write regression tests for the compressed WebSocket payload path',
  },
  {
    id: '08ccf935-3dea-4155-89b1-bfea6ea15a9f',
    name: 'host-streaming',
    role: 'teammate',
    phase: 'active',
    running: false,
    duty: 'Host side: stream SSE responses and send WS payloads as binary tunnel messages',
  },
  {
    id: '7dc4757f-a2c7-4951-9e5e-cd8491461eab',
    name: 'relay-streaming',
    role: 'teammate',
    phase: 'active',
    running: false,
    duty: 'Relay side: stream responses to the phone and forward binary WS payloads',
  },
];

const TEAM = {
  members: MEMBERS.map((member) => ({ id: member.id, name: member.name, role: member.role, phase: member.phase })),
  tasks: [
    {
      id: 'task-1',
      revision: 1,
      subject: '查清 Agent Team Board 的 lead 列为空的原因',
      description: '核对 lead 会话的轮次边界与 todo/write 事件，并与 host-streaming 的单轮会话对照。',
      status: 'completed',
      blockedBy: [],
      writeScopes: ['agent-team-board'],
      ownerName: 'lead',
      ready: false,
      writeScopeWarnings: [],
    },
    {
      id: 'task-2',
      revision: 1,
      subject: '插件宿主半边新增任务记录路由',
      description: '注册 GET /api/agent-team-board/history，在服务端过滤 todo 历史。',
      status: 'in_progress',
      blockedBy: [],
      writeScopes: ['agent-team-board/index.js'],
      ownerName: 'lead',
      ready: false,
      writeScopeWarnings: [],
    },
  ],
};

const sessionsState = {
  phase: 'ready',
  projectionsBySession: {
    ...Object.fromEntries(MEMBERS.map((member) => [member.id, {
      values: { modelSelection: { next: { model: 'MiniMax-M3.1-Flash' } } },
    }])),
    'session-c6966e37-ed74-4b5d-8187-7a6f138e3679': {
      values: {
        agentTeam: TEAM,
        subagentCatalog: MEMBERS
          .filter((member) => member.duty !== null)
          .map((member) => ({ id: member.id, label: member.duty })),
      },
    },
  },
  byId: Object.fromEntries(MEMBERS.map((member) => [member.id, {
    running: member.running,
    cwd: '/Users/ethansong/Documents/deepseek-harness/default-workspace',
    projectionValues: {
      // The running round's own list: empty for every member here, which is
      // what leaves the earlier rounds visible only through the Host route.
      todos: [],
      sessionStats: { turns: 1, steps: 12 },
    },
  }])),
};

const statusMap = new Map(MEMBERS.map((member) => [member.id, { running: member.running }]));

// The Host route the board reads one Session's complete task record from.
const realFetch = window.fetch.bind(window);
window.fetch = async (url, options) => {
  const asked = new URL(String(url), window.location.href).searchParams.get('sessionId');
  if (asked === null) return realFetch(url, options);
  return {
    ok: true,
    status: 200,
    json: async () => ({ sessionId: asked, items: RECORDS.get(asked) ?? [] }),
  };
};

const STRINGS = {
  'view.label': 'Team Board',
  'layout.member': 'By member',
  'layout.status': 'By status',
  'role.lead': 'Lead',
  'role.lead.duty': 'Leads the team — {count} members',
  'role.lead.solo': 'Working on its own',
  'role.teammate': 'Teammate',
  'memberStatus.running': 'Running',
  'memberStatus.inactive': 'Idle',
  'memberStatus.provisioning': 'Provisioning',
  'memberStatus.failed': 'Failed',
  'status.pending': 'Pending',
  'status.in_progress': 'In progress',
  'status.completed': 'Done',
  'task.owner': 'Owner',
  'task.unowned': 'Unassigned',
  'task.blockedBy': 'Blocked by',
  'task.ready': 'Ready',
  'task.blocked': 'Blocked',
  'task.scopes': 'Files',
  'task.expand': 'Show more',
  'task.collapse': 'Show less',
  'column.unassigned': 'Unassigned',
  'column.noTasks': 'No task recorded yet',
  'column.cost': '{tokens} tok · {duration}',
  'column.more': 'Show {count} more',
  'column.less': 'Show less',
  'column.earlier': '{count} from earlier rounds',
  'column.historyLoading': 'Reading the full record…',
  'column.historyFailed': 'The earlier record could not be read.',
  'roster.label': 'Team',
  'status.empty.pending': 'No pending task',
  'status.empty.in_progress': 'No task in progress',
  'status.empty.completed': 'No task done yet',
  'board.noSharedTasks': 'This team does not use the shared task board. Switch to “By member” to see every teammate’s responsibility and results.',
  'member.open': 'Open this member conversation',
  'member.avatar': 'Inspect this member',
  'summary.members': 'Members: {count}',
  'summary.tasks': 'Tasks: {count}',
  'summary.active': 'In progress: {count}',
  'summary.tokens': 'Tokens: {count}',
  'panel.duty': 'Responsibility',
  'panel.dutyMissing': 'No responsibility was recorded for this member.',
  'panel.brief': 'Full assignment brief',
  'panel.brief.expand': 'Show the full brief',
  'panel.brief.collapse': 'Hide the brief',
  'panel.tasks': 'Tasks',
  'panel.results': 'Results',
  'panel.steps': 'Completed steps',
  'panel.files': 'Files touched',
  'panel.results.missing': 'No result has been recorded yet.',
  'panel.avatar': 'Avatar',
  'panel.avatar.auto': 'Automatic',
  'panel.open': "Open this member's conversation",
  'panel.close': 'Close',
  'panel.workload': 'Turns {turns} · Steps {steps}',
};

/** Translate one key the way the Host's locale seat does. */
function translate(key, params) {
  const template = STRINGS[key];
  if (template === undefined) return key;
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

const registrations = [];
const ctx = {
  get: (name) => {
    if (name === 'uiWorkspace') return { openSession: () => {} };
    if (name === 'sidebarRight') return { openResource: () => {} };
    if (name === 'sessions') return { binding: () => undefined };
    return undefined;
  },
  effect: (callback) => callback(),
  locale: {
    bind: () => translate,
    register: () => () => {},
  },
  slots: {
    inject: (owner, callback) => callback(),
    register: (options, component) => registrations.push({ options, component }),
  },
};

apply(ctx);
const entry = registrations.find((row) => row.options?.id === 'agent-team-board');
const container = document.getElementById('board');
createRoot(container).render(h(entry.component, {
  sessionId: 'session-c6966e37-ed74-4b5d-8187-7a6f138e3679',
  useSession: (selector) => selector({ openState: 'ready', subagent: undefined }),
  useSessions: (selector) => selector(sessionsState),
  useSessionStatus: (selector) => selector(statusMap),
  t: translate,
}));

// `?layout=status` opens the status layout, so both views can be inspected.
const params = new URLSearchParams(window.location.search);
if (params.get('layout') === 'status') {
  setTimeout(() => {
    const status = [...document.querySelectorAll('.atb-layoutButton')]
      .find((button) => (button.textContent ?? '').trim() === 'By status');
    if (status !== undefined) status.click();
  }, 60);
}
