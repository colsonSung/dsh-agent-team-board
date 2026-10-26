/**
 * Local preview harness for the Agent Team Board.
 *
 * It mounts the real component with a mock client context and a sample team
 * roster — the same member names, the same responsibilities and the same
 * result counts the Harness shows — so the preview reproduces what the
 * application renders.
 */
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { apply } from '../../src/client-entry.js';

/** The roster as the Host projects it, with the duty each member was created with. */
const MEMBERS = [
  { id: 'lead', name: 'lead', role: 'lead', phase: 'active', running: true, duty: null, steps: [] },
  {
    id: 'parsers',
    name: 'parsers',
    role: 'teammate',
    phase: 'active',
    running: false,
    duty: '实现电子书解析层（EPUB/TXT/MD/HTML/PDF）',
    steps: [
      { content: 'Read CONTRACT.md and inspect existing project/shared layer', status: 'completed' },
      { content: 'Implement src/lib/parsers/source.js + dom.js helpers', status: 'completed' },
      { content: 'Implement src/lib/parsers/plain.js (txt/md/html)', status: 'completed' },
      { content: 'Implement src/lib/parsers/epub.js', status: 'completed' },
      { content: 'Implement src/lib/parsers/pdf.js', status: 'completed' },
      { content: 'Implement src/lib/parsers/index.js', status: 'in_progress' },
      { content: 'Write tests/parsers.test.mjs and make node --test pass', status: 'pending' },
      { content: 'Smoke-render the parser in jsdom to catch runtime errors', status: 'pending' },
    ],
  },
  {
    id: 'engine',
    name: 'engine',
    role: 'teammate',
    phase: 'active',
    running: false,
    duty: '实现精读引擎层（分句/比对/TTS同步/ASR）',
    steps: [
      { content: 'Read CONTRACT.md and inspect project conventions', status: 'completed' },
      { content: 'Implement src/lib/engine/segment.js (normalizeText/splitSentences)', status: 'completed' },
      { content: 'Implement src/lib/engine/match.js (diffTyping/diffWords)', status: 'completed' },
      { content: 'Implement src/lib/engine/tts.js (createTts with injectable synth)', status: 'completed' },
      { content: 'Implement src/lib/engine/asr.js (recognizer with injectable factory)', status: 'completed' },
      { content: 'Wire the engine into the reader', status: 'in_progress' },
      { content: 'Write tests/engine.test.mjs and make node --test pass', status: 'pending' },
      { content: 'Check the contract checklist item by item', status: 'pending' },
    ],
  },
  {
    id: 'ai-bridge',
    name: 'ai-bridge',
    role: 'teammate',
    phase: 'active',
    running: false,
    duty: '实现宿主 AI 通道与客户端调用',
    steps: [],
  },
  {
    id: 'vocab',
    name: 'vocab',
    role: 'teammate',
    phase: 'active',
    running: false,
    duty: '实现生词本数据层与面板',
    steps: [
      { content: 'Implement src/lib/vocab.js (data layer, injectable backend)', status: 'completed' },
      { content: 'Implement src/ui/wordlist.js (drawer panel, React.createElement)', status: 'completed' },
      { content: 'Write tests/vocab.test.mjs and make node --test pass', status: 'completed' },
      { content: 'Smoke-render the panel in jsdom to catch runtime errors', status: 'in_progress' },
      { content: 'Document the backend contract in the contract file', status: 'pending' },
    ],
  },
];

const TEAM = {
  members: MEMBERS.map((member) => ({ id: member.id, name: member.name, role: member.role, phase: member.phase })),
  tasks: [
    {
      id: 'task-1',
      revision: 1,
      subject: '实现精读页 UI（整段展示 / Type to Learn 打字模式）',
      description: 'lead 自挂任务：重点梳理、整段练习范围切换、逐字练习入口、底部词卡面板。',
      status: 'pending',
      blockedBy: [],
      writeScopes: ['english-reader/src/ui/reader.js'],
      ownerName: undefined,
      ready: true,
      writeScopeWarnings: [],
    },
  ],
};

const BRIEF = `You own one shared task.

## Background
The workspace holds the knowledge and engineering notes of the demo project.
An internal testing skill already exists and must not ship.

## Your deliverables
1. \`SKILL.md\` — the skill handed to the reader.
2. \`README.md\` — the overview of the package.
3. \`01-getting-started.md\` — the self-service guide.
4. \`02-developer-setup.md\` — the developer setup.
5. \`03-first-run.md\` — the first end-to-end run.

## Hard constraints
No internal information in a customer-facing document. Write in the market's
language: conclusion first, tables over prose, every step executable.`;

const sessionsState = {
  phase: 'ready',
  projectionsBySession: {
    ...Object.fromEntries(MEMBERS.map((member) => [member.id, {
      values: { modelSelection: { next: { model: 'MiniMax-M3.1-Flash' } } },
    }])),
    // The Lead's own projection carries the roster, so it is written last:
    // the lead is also a member, and both share one key.
    lead: {
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
    cwd: '/workspace/demo-project',
    projectionValues: {
      todos: member.steps.length > 0
        ? member.steps.map((step) => ({ content: step.content, status: step.status }))
        : null,
      ...(member.steps.length > 0 ? { titleInput: { first: { text: BRIEF } } } : {}),
      sessionStats: { turns: 1, steps: member.steps.length },
    },
  }])),
};

const statusMap = new Map(MEMBERS.map((member) => [member.id, { running: member.running }]));

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
    bind: () => (key, params) => (params === undefined
      ? key
      : `${key}[${Object.entries(params).map(([name, value]) => `${name}=${value}`).join(',')}]`),
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
  sessionId: 'lead',
  useSession: (selector) => selector({ openState: 'ready', subagent: undefined }),
  useSessions: (selector) => selector(sessionsState),
  useSessionStatus: (selector) => selector(statusMap),
  t: (key, params) => {
    const strings = {
      'view.label': 'Team Board',
      'layout.member': 'By member',
      'layout.status': 'By status',
      'role.lead': 'Lead',
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
      'column.noTasks': 'No shared task yet',
      'column.tasks': 'Task list',
      'column.sharedTasks': 'Shared tasks',
      'roster.label': 'Team',
      'status.empty.pending': 'No pending task',
      'status.empty.in_progress': 'No task in progress',
      'status.empty.completed': 'No task done yet',
      'board.noSharedTasks': 'This team does not use the shared task board. Switch to “By member” to see every teammate\u2019s responsibility and results.',
      'member.open': 'Open this member conversation',
      'member.avatar': 'Inspect this member',
      'member.done': '{count} done',
      'summary.members': 'Members: {count}',
      'summary.tasks': 'Tasks: {count}',
      'summary.active': 'In progress: {count}',
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
    const template = strings[key];
    if (template === undefined) return key;
    return params === undefined
      ? template
      : template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
  },
}));

// `?layout=status` opens the status layout, so both views can be inspected.
// The member panel opens on the first member that has results, unless the
// status layout was asked for.
const params = new URLSearchParams(window.location.search);
const wantsStatus = params.get('layout') === 'status';
setTimeout(() => {
  if (wantsStatus) {
    const status = [...document.querySelectorAll('.atb-layoutButton')]
      .find((button) => (button.textContent ?? '').trim() === 'By status');
    if (status !== undefined) status.click();
    return;
  }
  const avatars = [...document.querySelectorAll('.atb-avatarButton')];
  const withResults = avatars[3];
  if (withResults !== undefined) withResults.click();
}, 60);
