/**
 * Agent Team Board — a Conversation View tab that shows how the Agent Team is
 * cooperating.
 *
 * The board registers on the `conversation.view` slot, the same tab row that
 * carries Chat and Trajectory, so it appears directly beside Trajectory
 * without touching the host shell. It reads the Lead Session's `agentTeam`
 * projection from the shared Session store: Host projection frames keep it
 * current, so the board refreshes itself while a turn runs and performs no
 * Team RPC of its own.
 *
 * Two layouts share one dataset. The default is the member board: one column
 * per teammate, with that teammate's shared tasks as cards, so the column
 * width shows who is carrying the work. The second groups the same cards by
 * task status for a classic backlog view.
 *
 * Everything else is local: own artwork, own cards, and host theme tokens
 * only. No other Harness Client package is imported.
 */
import { createElement as h, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Avatar, GLYPHS, glyphFor, readAssignments, writeAssignment } from './avatars.js';

const NS = 'agentTeamBoard';
const PLUGIN_ID = '@local/agent-team-board';
/** Where the live View registration is kept, so a hot reload can retire it. */
const REGISTRATION_KEY = '__dshAgentTeamBoardRegistration';

/** Slot id of this View; the host addresses it by this id. */
const VIEW_ID = 'agent-team-board';
/**
 * Position among the View tabs, ascending. Chat registers at 0 and Trajectory
 * at 10, so this lands directly to the right of Trajectory.
 */
const VIEW_ORDER = 15;

/** Task statuses in board order. */
const STATUS_ORDER = ['pending', 'in_progress', 'completed'];

/** The route the Host half reads one session's complete task record from. */
const HISTORY_ROUTE = '/api/agent-team-board/history';

/** How many entries a list shows before the rest fold away behind a toggle. */
const COLLAPSE_LIMIT = 8;

/** How long one session's task history stays cached in the browser. */
const HISTORY_TTL_MS = 10_000;

/** The task histories read so far, keyed by Session id. */
const historyCache = new Map();

const en = {
  'view.label': 'Team Board',
  'board.loading': 'Loading the team…',
  'board.unavailable': 'This session has no agent team.',
  'board.hint': 'Ask the Lead to create teammates; the board fills in as soon as the roster exists.',
  'board.failure': 'Invalid persisted Team record: {message}',
  'summary.members': 'Members: {count}',
  'summary.tasks': 'Tasks: {count}',
  'summary.active': 'In progress: {count}',
  'summary.tokens': 'Tokens: {count}',
  'layout.member': 'By member',
  'layout.status': 'By status',
  'column.unassigned': 'Unassigned',
  'role.lead': 'Lead',
  'role.lead.duty': 'Leads the team — {count} members',
  'role.lead.solo': 'Working on its own',
  'role.teammate': 'Teammate',
  'memberStatus.running': 'Running',
  'memberStatus.inactive': 'Idle',
  'memberStatus.provisioning': 'Provisioning',
  'memberStatus.failed': 'Failed',
  'member.open': "Open this member's conversation",
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
  'panel.duty': 'Responsibility',
  'panel.dutyMissing': 'No responsibility was recorded for this member.',
  'panel.brief': 'Full assignment brief',
  'panel.brief.expand': 'Show the full brief',
  'panel.brief.collapse': 'Hide the brief',
  'panel.tasks': 'Tasks',
  'panel.results': 'Results',
  'panel.steps': 'Completed steps',
  'panel.files': 'Declared files',
  'panel.results.missing': 'This member recorded no steps of its own.',
  'panel.avatar': 'Avatar',
  'panel.avatar.auto': 'Automatic',
  'panel.open': "Open this member's conversation",
  'panel.close': 'Close',
  'panel.workload': 'Turns {turns} · Steps {steps}',
  'panel.tokens': 'Token usage',
  'panel.tokens.total': '{count} in total',
  'panel.tokens.missing': 'This member has consumed no tokens.',
  'panel.tokens.input': 'Uncached input',
  'panel.tokens.output': 'Output',
  'panel.tokens.cache': 'Cache read',
  'panel.tokens.cacheHit': 'Cache hit {percent}%',
  'panel.duration': '{duration} spent (model + tool)',
  'panel.artifacts': 'Artifacts',
  'panel.artifacts.loading': 'Reading what this member produced…',
  'panel.artifacts.empty': 'This member produced no files.',
  'panel.artifacts.failed': 'Its session log could not be read.',
  'member.avatar': 'Inspect this member',
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
};

const zh = {
  'view.label': '团队看板',
  'board.loading': '正在加载团队…',
  'board.unavailable': '当前会话没有智能体团队。',
  'board.hint': '让 Lead 创建成员后，看板会立即填充。',
  'board.failure': '团队持久记录无效：{message}',
  'summary.members': '{count} 名成员',
  'summary.tasks': '{count} 个任务',
  'summary.active': '{count} 个进行中',
  'summary.tokens': 'Token: {count}',
  'layout.member': '按成员',
  'layout.status': '按状态',
  'column.unassigned': '未分配',
  'role.lead': 'Lead',
  'role.lead.duty': '带 {count} 个成员的团队负责人',
  'role.lead.solo': '独自在工作',
  'role.teammate': '成员',
  'memberStatus.running': '运行中',
  'memberStatus.inactive': '空闲',
  'memberStatus.provisioning': '准备中',
  'memberStatus.failed': '失败',
  'member.open': '打开该成员的会话',
  'status.pending': '待处理',
  'status.in_progress': '进行中',
  'status.completed': '已完成',
  'task.owner': '负责人',
  'task.unowned': '未分配',
  'task.blockedBy': '依赖',
  'task.ready': '可开始',
  'task.blocked': '被阻塞',
  'task.scopes': '文件',
  'task.expand': '展开',
  'task.collapse': '收起',
  'panel.duty': '职责',
  'panel.dutyMissing': '该成员没有记录职责描述。',
  'panel.brief': '完整任务书',
  'panel.brief.expand': '展开完整任务书',
  'panel.brief.collapse': '收起任务书',
  'panel.tasks': '任务',
  'panel.results': '任务成果',
  'panel.steps': '已完成步骤',
  'panel.files': '声明的文件',
  'panel.results.missing': '该成员没有记录自己的任务清单。',
  'panel.avatar': '头像',
  'panel.avatar.auto': '自动',
  'panel.open': '打开该成员的会话',
  'panel.close': '关闭',
  'panel.workload': '{turns} 轮 · {steps} 步',
  'panel.tokens': 'Token 用量',
  'panel.tokens.total': '合计 {count}',
  'panel.tokens.missing': '该成员没有消耗任何 token。',
  'panel.tokens.input': '未缓存输入',
  'panel.tokens.output': '输出',
  'panel.tokens.cache': '缓存读取',
  'panel.tokens.cacheHit': '缓存命中 {percent}%',
  'panel.duration': '耗时 {duration}（模型 + 工具）',
  'panel.artifacts': '产出文件',
  'panel.artifacts.loading': '正在读取该成员的产出…',
  'panel.artifacts.empty': '该成员没有产出文件。',
  'panel.artifacts.failed': '无法读取它的会话日志。',
  'member.avatar': '查看该成员',
  'column.noTasks': '还没有登记任务',
  'column.cost': '{tokens} tok · {duration}',
  'column.more': '显示其余 {count} 条',
  'column.less': '收起',
  'column.earlier': '{count} 条来自更早的轮次',
  'column.historyLoading': '正在读取完整记录…',
  'column.historyFailed': '无法读取更早的记录。',
  'roster.label': '团队',
  'status.empty.pending': '没有待处理任务',
  'status.empty.in_progress': '没有进行中的任务',
  'status.empty.completed': '还没有完成的任务',
  'board.noSharedTasks': '这个团队没有使用共享任务板。切到「按成员」看每个人的职责与成果。',
};

/**
 * The board's own stylesheet: host tokens only, so the board follows the
 * active palette without a second stylesheet.
 */
const STYLE = `
.atb-root{position:relative;box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:0;flex:1 1 auto;align-self:stretch;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px}
.atb-bar{flex:none;display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.atb-title{font-size:13px;font-weight:500;white-space:nowrap}
.atb-layout{display:inline-flex;padding:2px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l1)}
.atb-layoutButton{border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:18px;padding:3px 10px;border-radius:4px;cursor:pointer;white-space:nowrap}
.atb-layoutButton:hover{color:var(--dsw-alias-label-primary)}
.atb-layoutButtonActive{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.atb-stats{display:flex;align-items:center;gap:12px;margin-left:auto;color:var(--dsw-alias-label-tertiary);font-size:12px;white-space:nowrap}
.atb-stat{display:inline-flex;align-items:center;gap:5px}
.atb-roster{flex:none;display:flex;align-items:center;gap:6px;padding:10px 20px;border-bottom:.5px solid var(--dsw-alias-border-l1);overflow-x:auto}
.atb-rosterButton{flex:none;display:inline-flex;align-items:center;gap:6px;padding:4px 10px 4px 4px;border:0;border-radius:999px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;cursor:pointer;line-height:1}
.atb-rosterButton:hover{border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.atb-rosterButton:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.atb-rosterName{max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.atb-hint{flex:none;margin:12px 20px 0;padding:9px 12px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l1);font-size:12px;color:var(--dsw-alias-label-secondary)}
.atb-board{flex:1;min-height:0;overflow:auto;display:flex;align-items:flex-start;gap:12px;padding:16px 20px 24px}
.atb-column{flex:none;position:relative;width:276px;max-width:320px;display:flex;flex-direction:column;gap:8px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);padding:10px}
/* A column that carries work in progress wears a halo: a soft breathing glow
   under it, and a light that runs around its edge. The travelling light is a
   conic gradient whose angle is animated, so the ring keeps the shape of the
   column instead of turning with it. */
@property --atb-halo-angle{syntax:'<angle>';inherits:false;initial-value:0deg}
@keyframes atb-halo-spin{to{--atb-halo-angle:360deg}}
@keyframes atb-halo-breathe{0%,100%{opacity:.45}50%{opacity:1}}
.atb-columnActive{border-color:color-mix(in srgb, var(--dsw-alias-state-business-primary) 45%, var(--dsw-alias-border-l1))}
.atb-columnActive::before{content:'';position:absolute;inset:-1px;border-radius:inherit;box-shadow:0 0 16px -2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 55%, transparent);animation:atb-halo-breathe 2.8s ease-in-out infinite;pointer-events:none}
.atb-columnActive::after{content:'';position:absolute;inset:-1px;border-radius:inherit;padding:1px;background:conic-gradient(from var(--atb-halo-angle), transparent 0turn 0.34turn, color-mix(in srgb, var(--dsw-alias-state-business-primary) 90%, transparent) 0.5turn, transparent 0.66turn, transparent 1turn);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;animation:atb-halo-spin 3.4s linear infinite;pointer-events:none}
@media (prefers-reduced-motion: reduce){.atb-columnActive::before,.atb-columnActive::after{animation:none}}
.atb-columnHead{display:flex;align-items:center;gap:6px;padding:2px 2px 6px;min-width:0}
.atb-columnName{font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.atb-columnRole{flex:none;font-size:10px;line-height:15px;color:var(--dsw-alias-label-tertiary);border:.5px solid var(--dsw-alias-border-l1);border-radius:4px;padding:0 4px}
.atb-columnCount{flex:none;margin-left:auto;font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.atb-group{display:flex;flex-direction:column;gap:6px;min-width:0;margin-top:2px}
.atb-group .atb-steps{gap:4px}
.atb-group .atb-step{font-size:11.5px;line-height:17px}
.atb-groupTitle{display:flex;align-items:center;gap:6px;margin:0;font-size:10.5px;font-weight:500;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}
.atb-groupCount{margin-left:auto;font-size:10.5px;color:var(--dsw-alias-label-dimmed);font-variant-numeric:tabular-nums}
.atb-stepOwner{flex:none;display:inline-flex;align-items:center;padding:0;border:0;background:transparent;cursor:pointer;border-radius:var(--dsw-radius-sm);line-height:0}
.atb-stepOwner:hover{box-shadow:0 0 0 2px var(--dsw-alias-interactive-bg-hover)}
.atb-memberButton{flex:1;min-width:0;display:flex;align-items:center;gap:6px;border:0;background:transparent;color:inherit;font:inherit;padding:0;cursor:pointer;text-align:left}
.atb-memberButton:hover .atb-columnName{color:var(--dsw-alias-label-primary)}
.atb-memberMeta{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.atb-memberModel{font-size:10.5px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.atb-columnDuty{margin:2px 2px 0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.atb-columnStats{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin:0 2px}
.atb-statPill{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;line-height:17px;border-radius:9px;padding:0 7px;border:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.atb-statPillPending{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, transparent)}
.atb-statPillProgress{color:var(--dsw-alias-state-business-primary);border-color:color-mix(in srgb, var(--dsw-alias-state-business-primary) 40%, transparent)}
.atb-statPillDone{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, transparent)}
.atb-statCount{font-weight:500;font-variant-numeric:tabular-nums}
.atb-columnCost{margin:0 2px;font-size:10.5px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.atb-columnMeta{margin:0 2px;font-size:10.5px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.atb-fold{margin-top:6px;padding:2px 0;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;line-height:16px;cursor:pointer;text-align:left}
.atb-fold:hover{color:var(--dsw-alias-label-primary)}
.atb-tokenTotal{font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-primary);margin:0 0 6px}
.atb-tokenLine{margin:0 0 4px;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary)}
.atb-cards{display:flex;flex-direction:column;gap:7px}
.atb-card{border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:9px;padding:9px 11px;display:flex;flex-direction:column;gap:6px}
.atb-cardTitle{font-size:12.5px;font-weight:500;line-height:18px;word-break:break-word}
.atb-desc{font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;margin:0;word-break:break-word}
.atb-descClamp{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.atb-meta{display:flex;flex-wrap:wrap;align-items:center;gap:5px 10px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.atb-metaItem{display:inline-flex;align-items:center;gap:4px;min-width:0}
.atb-metaValue{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px}
.atb-pill{display:inline-flex;align-items:center;gap:4px;flex:none;font-size:10px;line-height:16px;border-radius:9px;padding:0 6px;border:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.atb-pill .atb-stepMark{width:11px;height:11px;margin-top:0}
.atb-pillProgress{color:var(--dsw-alias-state-business-primary);border-color:color-mix(in srgb, var(--dsw-alias-state-business-primary) 40%, transparent)}
.atb-pillDone{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, transparent)}
.atb-pillBlocked{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent)}
.atb-warning{color:var(--dsw-alias-state-warn-primary)}
.atb-expand{flex:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;padding:0;cursor:pointer;display:inline-flex;align-items:center;gap:2px}
.atb-expand:hover{color:var(--dsw-alias-label-primary)}
.atb-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-dimmed)}
.atb-dotRunning{background:var(--dsw-alias-state-business-primary)}
.atb-dotProvisioning{background:var(--dsw-alias-state-business-primary);opacity:.5}
.atb-dotFailed{background:var(--dsw-alias-state-error-primary)}
.atb-dotPending{background:var(--dsw-alias-state-warn-primary)}
.atb-dotProgress{background:var(--dsw-alias-state-business-primary)}
.atb-dotDone{background:var(--dsw-alias-state-success-primary)}
.atb-empty{padding:6px 4px;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.atb-notice{display:flex;flex-direction:column;gap:6px;padding:28px 20px;color:var(--dsw-alias-label-tertiary);font-size:12.5px;line-height:19px}
.atb-error{display:flex;align-items:center;gap:8px;margin:12px 20px 0;padding:9px 12px;border-radius:var(--dsw-radius-md);font-size:12px;color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-state-error-primary)}
.atb-avatar{flex:none;display:inline-flex;align-items:center;justify-content:center;overflow:hidden;box-shadow:inset 0 0 0 0.5px rgba(0,0,0,.12)}
.atb-avatarButton{flex:none;display:inline-flex;padding:0;border:0;background:transparent;border-radius:var(--dsw-radius-sm);cursor:pointer;line-height:0}
.atb-avatarButton:hover .atb-avatar{box-shadow:inset 0 0 0 0.5px rgba(0,0,0,.12), 0 0 0 2px var(--dsw-alias-interactive-bg-hover)}
.atb-avatarButton:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.atb-scrim{position:absolute;inset:0;z-index:1;background:rgba(0,0,0,.06)}
.atb-panel{position:absolute;z-index:2;top:0;right:0;bottom:0;width:392px;max-width:100%;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);border-left:.5px solid var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);overflow:hidden}
.atb-panelHead{flex:none;display:flex;align-items:flex-start;gap:10px;padding:14px 16px 12px;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.atb-panelIdentity{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}
.atb-panelName{font-size:13.5px;font-weight:500;line-height:19px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.atb-panelMeta{font-size:11.5px;color:var(--dsw-alias-label-tertiary);line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.atb-panelClose{flex:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font:inherit;font-size:16px;line-height:1;padding:4px 6px;border-radius:var(--dsw-radius-sm)}
.atb-panelClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.atb-panelBody{flex:1;min-height:0;overflow-y:auto;padding:4px 16px 20px}
.atb-section{padding:14px 0;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.atb-section:last-child{border-bottom:0}
.atb-sectionTitle{font-size:11px;font-weight:500;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);margin:0 0 8px}
.atb-subTitle{font-size:11px;font-weight:500;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);margin:14px 0 6px}
.atb-duty{font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-primary);white-space:pre-wrap;overflow-wrap:anywhere}
.atb-dutyMuted{font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:18px}
.atb-brief{margin-top:8px;padding:10px 12px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l1);font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;max-height:280px;overflow-y:auto}
.atb-link{flex:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11.5px;padding:0;cursor:pointer;display:inline-flex;align-items:center;gap:4px}
.atb-link:hover{color:var(--dsw-alias-label-primary)}
.atb-picker{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.atb-pickerButton{flex:none;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;background:transparent;border-radius:var(--dsw-radius-sm);cursor:pointer}
.atb-pickerButton:hover{background:var(--dsw-alias-interactive-bg-hover)}
.atb-pickerButtonActive{box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary)}
.atb-pickerAuto{font-size:11px;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);padding:4px 8px;cursor:pointer;background:transparent}
.atb-steps{display:flex;flex-direction:column;gap:5px;margin:0;padding:0;list-style:none}
.atb-step{display:flex;align-items:flex-start;gap:7px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.atb-stepMark{flex:none;width:14px;height:14px;margin-top:2px;display:block;overflow:visible}
.atb-markPending{color:var(--dsw-alias-label-tertiary)}
.atb-markProgress{color:var(--dsw-alias-state-business-primary)}
.atb-markDone{color:var(--dsw-alias-state-success-primary)}
.atb-stepPending{color:var(--dsw-alias-label-tertiary)}
.atb-files{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.atb-file{display:inline-flex;align-items:center;gap:5px;max-width:100%;font-size:11px;line-height:20px;padding:2px 8px;border-radius:var(--dsw-radius-sm);border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);cursor:pointer;font-family:var(--dsh-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace)}
.atb-file:hover{border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary)}
.atb-filePath{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:230px}
.atb-panelTask{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2)}
.atb-panelTaskTitle{font-size:12px;font-weight:500;line-height:18px}
.atb-panelTaskMeta{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.atb-panelList{display:flex;flex-direction:column;gap:7px}
.atb-panelAction{display:inline-flex;align-items:center;gap:6px;margin-top:12px;font-size:11.5px;padding:5px 10px;border-radius:var(--dsw-radius-md);border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);cursor:pointer;font-family:inherit}
.atb-panelAction:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}
`;

/**
 * Install the board's stylesheet; the module system removes it with the plugin.
 * @returns {Function} the disposer that removes the stylesheet.
 */
function installStyles() {
  const style = document.createElement('style');
  style.setAttribute('data-plugin', PLUGIN_ID);
  style.textContent = STYLE;
  document.head.appendChild(style);
  return () => { style.remove(); };
}

/**
 * Map a task status to its pill class.
 * @param {string} status - the durable task status.
 * @returns {string} the pill class name.
 */
function statusPillClass(status) {
  if (status === 'in_progress') return 'atb-pill atb-pillProgress';
  if (status === 'completed') return 'atb-pill atb-pillDone';
  return 'atb-pill';
}

/**
 * The class of a board column. A column that carries work in progress wears
 * the halo, so the board says where the work is without being read.
 * @param {boolean} active - whether the column carries work in progress.
 * @returns {string} the class name.
 */
function columnClass(active) {
  return active ? 'atb-column atb-columnActive' : 'atb-column';
}

/**
 * Whether a set of board items carries work in progress.
 * @param {Array<object>} items - the items, each carrying a status.
 * @returns {boolean} true when at least one item is in progress.
 */
function hasWorkInProgress(items) {
  return (items ?? []).some((item) => item?.status === 'in_progress');
}

/**
 * Map a task status to its dot class.
 * @param {string} status - the durable task status.
 * @returns {string} the dot class name.
 */
function statusDotClass(status) {
  if (status === 'completed') return 'atb-dot atb-dotDone';
  if (status === 'in_progress') return 'atb-dot atb-dotProgress';
  return 'atb-dot atb-dotPending';
}

/**
 * Map a task status to the class of its count pill.
 * @param {string} status - the durable task status.
 * @returns {string} the pill class name.
 */
function statusStatClass(status) {
  if (status === 'in_progress') return 'atb-statPill atb-statPillProgress';
  if (status === 'completed') return 'atb-statPill atb-statPillDone';
  return 'atb-statPill atb-statPillPending';
}

/**
 * Format a token count the way the host's own counter does: 15.5M, 8.4M,
 * 10M, 535K.
 * @param {number} count - the number of tokens.
 * @returns {string} the compact form.
 */
function formatTokens(count) {
  if (!Number.isFinite(count) || count <= 0) return '0';
  for (const [scale, suffix] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) {
    if (count < scale) continue;
    const value = count / scale;
    // One decimal, but a whole number keeps none: 10M, not 10.0M.
    const text = value.toFixed(1).replace(/\.0$/, '');
    return `${text}${suffix}`;
  }
  return String(count);
}

/**
 * Format a duration in milliseconds: 6m 19s, 52m 17s, 1h 4m.
 * @param {number} ms - the duration.
 * @returns {string} the compact form.
 */
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const seconds = Math.round(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * The token buckets of one session, in the order the host counts them: the
 * uncached input, the output, and what was read back from the cache.
 * @param {object} usage - the `tokenUsage` projection value.
 * @returns {object} the four bucket counts plus their total.
 */
function tokenBuckets(usage) {
  // The client projects the buckets themselves; the host's own record wraps
  // them in `totals`. Both shapes are accepted.
  const totals = usage?.totals ?? usage ?? {};
  const uncached = totals.uncachedInputTokens ?? 0;
  const output = totals.outputTokens ?? 0;
  const cacheRead = totals.cacheReadTokens ?? 0;
  const cacheWrite = totals.cacheWriteTokens ?? 0;
  return { uncached, output, cacheRead, cacheWrite, total: uncached + output + cacheRead + cacheWrite };
}

/**
 * Read one session's complete task record from the Host half.
 *
 * The `todos` projection only carries the list of the round that is running: a
 * new round starts with an empty list, so the work of earlier rounds is gone
 * from it. The Host reads the session log and answers with every item that
 * session ever recorded, so the board can show the whole record instead of one
 * round's slice of it.
 * @param {string} sessionId - the member's Session id.
 * @returns {Promise<Array<object>>} the recorded items, newest first.
 */
async function fetchTodoHistory(sessionId) {
  const cached = historyCache.get(sessionId);
  if (cached !== undefined && Date.now() - cached.at < HISTORY_TTL_MS) return cached.items;
  const response = await fetch(`${HISTORY_ROUTE}?${new URLSearchParams({ sessionId }).toString()}`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`the task history answered ${response.status}`);
  const body = await response.json();
  const items = Array.isArray(body?.items) ? body.items : [];
  historyCache.set(sessionId, { at: Date.now(), items });
  return items;
}

/**
 * One member's complete task record: what it recorded in the round that is
 * running, plus what earlier rounds recorded and the projection no longer
 * carries.
 *
 * An item the running round also lists counts once, and the running round wins
 * its status: it is the newest word on that item.
 * @param {Array<object>} currentTodos - the `todos` projection value.
 * @param {Array<object>} historyItems - the items read from the session log.
 * @returns {Array<object>} the merged record, newest first.
 */
function mergeTaskItems(currentTodos, historyItems) {
  const items = new Map();
  const add = (content, status, origin, seq) => {
    if (typeof content !== 'string' || content === '') return;
    items.set(content, { content, status: status ?? 'pending', origin, seq });
  };
  for (const item of historyItems ?? []) {
    add(item?.content, item?.status, 'history', typeof item?.seq === 'number' ? item.seq : 0);
  }
  for (const todo of currentTodos ?? []) {
    add(todo?.content, todo?.status, 'current', Number.MAX_SAFE_INTEGER);
  }
  // Newest first: the running round leads, then the history by the write that
  // touched an item last.
  return [...items.values()].sort((left, right) => right.seq - left.seq);
}

/**
 * Map a member status to its dot class.
 * @param {string} status - the member status.
 * @returns {string} the dot class name.
 */
function memberDotClass(status) {
  if (status === 'running') return 'atb-dot atb-dotRunning';
  if (status === 'provisioning') return 'atb-dot atb-dotProvisioning';
  if (status === 'failed') return 'atb-dot atb-dotFailed';
  return 'atb-dot';
}

/**
 * Parse a tool call's arguments, which arrive either as a JSON string or as
 * an object.
 * @param {unknown} raw - the raw arguments.
 * @returns {object|undefined} the parsed arguments.
 */
function parseToolArguments(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return undefined;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The files a member actually produced, taken from the write, edit and
 * present tool calls in its own session log. The shared task board only
 * declares a scope; this is what really landed on disk.
 * @param {Array<object>} records - the session events.
 * @returns {Array<object>} the artifacts, in the order they were produced.
 */
function extractArtifacts(records) {
  const artifacts = [];
  const seen = new Set();
  const add = (path, tool) => {
    if (typeof path !== 'string' || path === '' || seen.has(path)) return;
    seen.add(path);
    artifacts.push({ path, tool });
  };
  for (const record of records ?? []) {
    const event = record?.event;
    if (event?.type !== 'tool/call') continue;
    const data = event.data ?? {};
    const tool = data.name;
    if (tool !== 'write' && tool !== 'edit' && tool !== 'present') continue;
    const args = parseToolArguments(data.arguments);
    if (args === undefined) continue;
    add(args.file_path ?? args.filePath ?? args.path, tool);
    for (const file of Array.isArray(args.files) ? args.files : []) {
      add(typeof file === 'string' ? file : file?.path, tool);
    }
  }
  return artifacts;
}

/**
 * Read one session's events through the host's session journal.
 *
 * The journal pages events up to an inclusive sequence number, and rejects a
 * number the session never reached. The member's own projection carries the
 * sequence of its last completed step, which is close enough to the end; when
 * the host rejects it, the newest accepted sequence is found by doubling and
 * then halving the gap.
 * @param {object} remote - the generated remote namespaces.
 * @param {object} address - the member's subagent address.
 * @param {number} hintSeq - the last completed step boundary sequence.
 * @returns {Promise<Array<object>>} the session events.
 */
async function readSessionEvents(remote, address, hintSeq) {
  const page = async (throughSeq, maxMessages) => {
    const result = await remote.session.page({ address, throughSeq, maxMessages });
    return result.ok ? result.value.records : undefined;
  };
  const safe = async (throughSeq, maxMessages) => page(throughSeq, maxMessages).catch(() => undefined);
  const accepted = async (throughSeq) => (await safe(throughSeq, 1)) !== undefined;
  // Start from the member's last completed step, which is a sequence the
  // host certainly accepts.
  let good = 0;
  if (hintSeq > 0 && await accepted(hintSeq)) good = hintSeq;
  // Walk to the newest sequence the host accepts. A member that is still
  // running has events past its last completed step, and those carry the
  // files it just wrote.
  let bad = good + 1;
  let step = 1;
  let candidate = good + 1;
  while (candidate <= good + (1 << 20)) {
    if (!await accepted(candidate)) {
      bad = candidate;
      break;
    }
    good = candidate;
    step *= 2;
    candidate = good + step;
  }
  if (candidate > good + (1 << 20)) bad = candidate;
  while (good + 1 < bad) {
    const middle = Math.floor((good + bad) / 2);
    if (await accepted(middle)) good = middle;
    else bad = middle;
  }
  const records = await safe(good, 4000);
  return records ?? [];
}

/**
 * The files a member actually produced, read from its own session log.
 * @param {object} ctx - the client plugin context.
 * @param {string} memberId - the member's Session id.
 * @param {number} hintSeq - the last completed step boundary sequence.
 * @returns {Promise<Array<object>>} the artifacts.
 */
async function readMemberArtifacts(ctx, memberId, hintSeq) {
  const sessions = ctx.get('sessions');
  const remote = sessions?.manager?.remote;
  if (sessions === undefined || remote === undefined) return [];
  const address = sessions.subagentAddress?.(memberId);
  // The Lead is an ordinary Session; a teammate is addressed by its parent.
  const target = address === undefined
    ? { kind: 'session', sessionId: memberId }
    : { kind: 'subagent', ...address };
  const records = await readSessionEvents(remote, target, hintSeq);
  return extractArtifacts(records);
}

/**
 * Make a path relative to the directory the member worked in.
 * @param {string} cwd - the member's working directory.
 * @param {string} path - the recorded path.
 * @returns {string} the path relative to the working directory.
 */
function relativeToCwd(cwd, path) {
  if (typeof cwd !== 'string' || cwd === '' || typeof path !== 'string') return path;
  const base = cwd.endsWith('/') ? cwd : `${cwd}/`;
  return path.startsWith(base) ? path.slice(base.length) : path;
}

/**
 * The icon that says what state one item is in.
 *
 * A glyph borrowed from a text font cannot be lined up with the row it
 * belongs to, and it changes shape with the platform's font. The three states
 * are therefore drawn here: an empty ring for work that has not started, a
 * ring with a solid core for work in progress, and a soft disc with a crisp
 * check for work that is done.
 * @param {object} props - component props.
 * @param {string} props.status - the item status.
 * @param {number} [props.size] - the icon's edge length in pixels.
 * @returns the icon element tree.
 */
function StatusMark({ status, size = 14 }) {
  const className = status === 'completed'
    ? 'atb-stepMark atb-markDone'
    : status === 'in_progress'
      ? 'atb-stepMark atb-markProgress'
      : 'atb-stepMark atb-markPending';
  return h(
    'svg',
    {
      className,
      viewBox: '0 0 14 14',
      width: size,
      height: size,
      'aria-hidden': 'true',
      focusable: 'false',
    },
    status === 'completed'
      ? [
        h('circle', { key: 'disc', cx: 7, cy: 7, r: 6.6, fill: 'currentColor', opacity: 0.16 }),
        h('path', {
          key: 'tick',
          d: 'M4.1 7.3 L6.1 9.2 L9.9 5.1',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      ]
      : status === 'in_progress'
        ? [
          h('circle', { key: 'ring', cx: 7, cy: 7, r: 5.3, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, opacity: 0.45 }),
          h('circle', { key: 'core', cx: 7, cy: 7, r: 2.7, fill: 'currentColor' }),
        ]
        : h('circle', { key: 'ring', cx: 7, cy: 7, r: 5.3, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, opacity: 0.6 }),
  );
}

/**
 * One shared task, rendered as a card.
 * @param {object} props - component props.
 * @param {object} props.task - the projected task view.
 * @param {Function} props.t - the bound translator.
 * @returns the card element tree.
 */
function TaskCard({ task, t }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const textRef = useRef(null);
  // A projected field can be null rather than absent, so every list is read
  // through one safe accessor.
  const blockedBy = task.blockedBy ?? [];
  const writeScopes = task.writeScopes ?? [];
  const writeScopeWarnings = task.writeScopeWarnings ?? [];

  // The description is clamped to three lines; the toggle only appears when
  // the text really is cut off, which is measured rather than guessed.
  useLayoutEffect(() => {
    if (expanded) return undefined;
    const paragraph = textRef.current;
    if (paragraph === null) return undefined;
    const measure = () => {
      setClamped(paragraph.scrollHeight > paragraph.clientHeight + 1);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(paragraph);
    return () => { observer.disconnect(); };
  }, [expanded, task.description]);

  const description = typeof task.description === 'string' ? task.description.trim() : '';
  return h(
    'div',
    { className: 'atb-card' },
    h('div', { className: 'atb-cardTitle' }, task.subject),
    h(
      'div',
      { className: 'atb-meta' },
      h('span', { className: statusPillClass(task.status) },
        h(StatusMark, { status: task.status, size: 11 }),
        t(`status.${task.status}`)),
      task.status === 'pending'
        ? h(
          'span',
          { className: task.ready ? 'atb-pill atb-pillDone' : 'atb-pill atb-pillBlocked' },
          t(task.ready ? 'task.ready' : 'task.blocked'),
        )
        : null,
    ),
    description.length > 0
      ? h(
        'p',
        {
          ref: textRef,
          // The clamp is applied first and measured afterwards: an unclamped
          // paragraph reports no overflow, so measuring before the clamp
          // would never find one.
          className: expanded ? 'atb-desc' : 'atb-desc atb-descClamp',
        },
        description,
      )
      : null,
    h(
      'div',
      { className: 'atb-meta' },
      h(
        'span',
        { className: 'atb-metaItem' },
        `${t('task.owner')}:`,
        h('span', { className: 'atb-metaValue' }, task.ownerName ?? t('task.unowned')),
      ),
      blockedBy.length > 0
        ? h(
          'span',
          { className: 'atb-metaItem' },
          `${t('task.blockedBy')}:`,
          h('span', { className: 'atb-metaValue' }, blockedBy.join(', ')),
        )
        : null,
      writeScopes.length > 0
        ? h(
          'span',
          { className: 'atb-metaItem' },
          `${t('task.scopes')}:`,
          h('span', { className: 'atb-metaValue' }, writeScopes.join(', ')),
        )
        : null,
      writeScopeWarnings.map((warning) => h(
        'span',
        { key: warning, className: 'atb-metaItem atb-warning' },
        warning,
      )),
    ),
    clamped
      ? h(
        'button',
        {
          type: 'button',
          className: 'atb-expand',
          onClick: () => { setExpanded((value) => !value); },
        },
        t(expanded ? 'task.collapse' : 'task.expand'),
      )
      : null,
  );
}

/**
 * One teammate, rendered as a board column.
 *
 * The column breaks the member's work down by status — pending, in progress,
 * done — with the shared tasks it owns and the steps it recorded in the same
 * three buckets the status layout uses. A member therefore shows its own
 * backlog without switching layouts, and the counts above the list say at a
 * glance what it has not started yet.
 * @param {object} props - component props.
 * @param {object} props.member - the projected member.
 * @param {Array<object>} props.tasks - the tasks this member owns.
 * @param {Function} props.useSessionStatus - the standard status hook.
 * @param {Function} props.useSessions - the standard sessions hook.
 * @param {Function} props.onOpen - opens this member's conversation.
 * @param {Function} props.onInspect - opens this member's detail panel.
 * @param {string} props.leadSessionId - the Lead Session that owns the roster.
 * @param {string} [props.glyphId] - the avatar glyph pinned to this member.
 * @param {Function} props.t - the bound translator.
 * @returns the column element tree.
 */
function MemberColumn({ member, tasks, steps, historyState, leadDuty, useSessionStatus, useSessions, onOpen, onInspect, leadSessionId, glyphId, t }) {
  // Live session status decides whether an active member is running; the
  // roster phase decides the rest.
  const running = useSessionStatus((state) => state.get(member.id)?.running);
  const summaryRunning = useSessions((state) => state.byId[member.id]?.running);
  const model = useSessions((state) => state.projectionsBySession[member.id]?.values.modelSelection?.next?.model);
  // The responsibility and the results come from the member's own records:
  // the roster label the Lead created it with, and the steps it reported.
  const catalogDuty = useSessions((state) => state.projectionsBySession[leadSessionId]
    ?.values.subagentCatalog?.find((child) => child.id === member.id)?.label);
  // The Lead is never in the catalog, so it gets a duty of its own instead of
  // being reported as a member without a responsibility.
  const duty = catalogDuty !== undefined && catalogDuty !== null && catalogDuty !== ''
    ? catalogDuty
    : member.role === 'lead' ? leadDuty : undefined;
  // What the member's own turns cost: the tokens they consumed and the time
  // they took. The buckets are the ones the host's subagent list counts.
  const usage = useSessions((state) => state.byId[member.id]?.projectionValues?.tokenUsage);
  const memberStats = useSessions((state) => state.byId[member.id]?.projectionValues?.sessionStats);
  const buckets = tokenBuckets(usage);
  const durationMs = (memberStats?.llmMs ?? 0) + (memberStats?.toolMs ?? 0);
  // The member's complete task record, newest first: what the running round
  // recorded plus what earlier rounds recorded.
  const stepList = (steps ?? []).filter((step) => step !== null && step !== undefined && typeof step.content === 'string');
  // Which status groups the user has unfolded.
  const [expanded, setExpanded] = useState({});
  const toggle = (key) => setExpanded((previous) => ({ ...previous, [key]: previous[key] !== true }));
  // The items that come from earlier rounds, which the running projection no
  // longer carries.
  const earlierCount = stepList.filter((step) => step.origin === 'history').length;
  // The member's work by status: the shared tasks it owns and the steps it
  // recorded, in the same three buckets the status layout uses. A step with
  // no status is still work, so it counts as pending.
  const groups = STATUS_ORDER.map((status) => ({
    status,
    tasks: tasks.filter((task) => task.status === status),
    steps: stepList.filter((step) => (step.status ?? 'pending') === status),
  }));
  const itemCount = groups.reduce((count, group) => count + group.tasks.length + group.steps.length, 0);
  // Work in progress is what the column is about right now, so the column
  // wears the halo while it lasts. Both kinds of work count: the shared task
  // it owns and the step it recorded itself.
  const inProgress = groups.find((group) => group.status === 'in_progress');
  const active = inProgress !== undefined
    && inProgress.tasks.length + inProgress.steps.length > 0;
  const status = member.phase === 'active'
    ? (running ?? summaryRunning) === true ? 'running' : 'inactive'
    : member.phase;
  return h(
    'section',
    { className: columnClass(active) },
    h(
      'div',
      { className: 'atb-columnHead' },
      h(
        'button',
        {
          type: 'button',
          className: 'atb-avatarButton',
          title: t('member.avatar'),
          'aria-label': `${t('member.avatar')} ${member.name}`,
          onClick: () => { onInspect(member.id); },
        },
        h(Avatar, { name: member.name, glyphId, size: 20 }),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'atb-memberButton',
          title: t('member.open'),
          onClick: () => { onOpen(member.id); },
        },
        h('span', { className: memberDotClass(status), 'aria-hidden': 'true' }),
        h(
          'span',
          { className: 'atb-memberMeta' },
          h('span', { className: 'atb-columnName' }, member.name),
          h(
            'span',
            { className: 'atb-memberModel' },
            `${t(`memberStatus.${status}`)}${model == null ? '' : ` · ${model}`}`,
          ),
        ),
      ),
      h('span', { className: 'atb-columnRole' }, t(member.role === 'lead' ? 'role.lead' : 'role.teammate')),
      h('span', { className: 'atb-columnCount' }, String(itemCount)),
    ),
    duty === undefined || duty === null || duty === ''
      ? null
      : h('p', { className: 'atb-columnDuty', title: duty }, duty),
    // What this member's work cost. A member that never ran has no number.
    buckets.total > 0
      ? h(
        'p',
        { className: 'atb-columnCost' },
        t('column.cost', { tokens: formatTokens(buckets.total), duration: formatDuration(durationMs) }),
      )
      : null,
    // The status breakdown. All three counts are always shown, so a column
    // says what the member has not started as clearly as what it finished.
    h(
      'div',
      { className: 'atb-columnStats' },
      groups.map((group) => h(
        'span',
        { key: group.status, className: statusStatClass(group.status) },
        t(`status.${group.status}`),
        h('span', { className: 'atb-statCount' }, String(group.tasks.length + group.steps.length)),
      )),
    ),
    // How much of the record came from earlier rounds, and whether the log has
    // been read yet.
    historyState === 'loading'
      ? h('p', { className: 'atb-columnMeta' }, t('column.historyLoading'))
      : historyState === 'failed'
        ? h('p', { className: 'atb-columnMeta' }, t('column.historyFailed'))
        : earlierCount > 0
          ? h('p', { className: 'atb-columnMeta' }, t('column.earlier', { count: String(earlierCount) }))
          : null,
    // The member's work, grouped by status. A group without work is not
    // rendered: the counts above already say it is empty.
    groups.map((group) => {
      const count = group.tasks.length + group.steps.length;
      if (count === 0) return null;
      // The newest entries stay on screen; the rest fold away until the user
      // asks for them.
      const shown = expanded[group.status] === true ? group.steps : group.steps.slice(0, COLLAPSE_LIMIT);
      const hidden = group.steps.length - shown.length;
      return h(
        'div',
        { key: group.status, className: 'atb-group' },
        h(
          'p',
          { className: 'atb-groupTitle' },
          h('span', { className: statusDotClass(group.status), 'aria-hidden': 'true' }),
          t(`status.${group.status}`),
          h('span', { className: 'atb-groupCount' }, String(count)),
        ),
        group.tasks.length > 0
          ? h(
            'div',
            { className: 'atb-cards' },
            group.tasks.map((task) => h(TaskCard, { key: task.id, task, t })),
          )
          : null,
        group.steps.length > 0
          ? h(
            'div',
            null,
            h(
              'ul',
              { className: 'atb-steps' },
              shown.map((step, index) => h(
                'li',
                {
                  key: `${group.status}-${index}-${step.content}`,
                  className: step.status === 'completed' ? 'atb-step' : 'atb-step atb-stepPending',
                },
                h(StatusMark, { status: step.status }),
                h('span', {}, step.content),
              )),
            ),
            group.steps.length > COLLAPSE_LIMIT
              ? h(
                'button',
                {
                  type: 'button',
                  className: 'atb-fold',
                  onClick: () => { toggle(group.status); },
                },
                expanded[group.status] === true
                  ? t('column.less')
                  : t('column.more', { count: String(hidden) }),
              )
              : null,
          )
          : null,
      );
    }),
    itemCount === 0
      ? h('p', { className: 'atb-empty' }, t('column.noTasks'))
      : null,
  );
}

/**
 * One task status, rendered as a board column. It carries the shared tasks in
 * that status and the task items every member recorded in it, so the status
 * view never hides work that the member view shows.
 * @param {object} props - component props.
 * @param {string} props.status - the task status.
 * @param {Array<object>} props.tasks - the shared tasks in this status.
 * @param {Array<object>} props.steps - the member task items in this status.
 * @param {Record<string, string>} props.assignments - the pinned avatar glyphs.
 * @param {Function} props.onInspect - opens a member's panel.
 * @param {Function} props.t - the bound translator.
 * @returns the column element tree.
 */
function StatusColumn({ status, tasks, steps, assignments, onInspect, t }) {
  const dotClass = statusDotClass(status);
  // Only the in-progress column carries work in progress, so only it wears
  // the halo — and only while it holds something.
  const active = status === 'in_progress' && tasks.length + steps.length > 0;
  // The newest entries stay on screen; the rest fold away until the user asks
  // for them.
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? steps : steps.slice(0, COLLAPSE_LIMIT);
  const hidden = steps.length - shown.length;
  return h(
    'section',
    { className: columnClass(active) },
    h(
      'div',
      { className: 'atb-columnHead' },
      h('span', { className: dotClass, 'aria-hidden': 'true' }),
      h('span', { className: 'atb-columnName' }, t(`status.${status}`)),
      h('span', { className: 'atb-columnCount' }, String(tasks.length + steps.length)),
    ),
    h(
      'div',
      { className: 'atb-cards' },
      tasks.map((task) => h(TaskCard, { key: task.id, task, t })),
    ),
    steps.length === 0
      ? (tasks.length === 0 ? h('p', { className: 'atb-empty' }, t(`status.empty.${status}`)) : null)
      : h(
        'div',
        { className: 'atb-columnSteps' },
        h(
          'ul',
          { className: 'atb-steps' },
          shown.map(({ member, step }, index) => h(
            'li',
            {
              key: `${member.id}-${index}-${step.content}`,
              className: step.status === 'completed' ? 'atb-step' : 'atb-step atb-stepPending',
            },
            h(
              'button',
              {
                type: 'button',
                className: 'atb-stepOwner',
                title: t('member.avatar'),
                'aria-label': `${t('member.avatar')} ${member.name}`,
                onClick: () => { onInspect(member.id); },
              },
              h(Avatar, { name: member.name, glyphId: assignments[member.name], size: 16 }),
            ),
            h('span', {}, step.content),
          )),
        ),
        steps.length > COLLAPSE_LIMIT
          ? h(
            'button',
            {
              type: 'button',
              className: 'atb-fold',
              onClick: () => { setExpanded((value) => !value); },
            },
            expanded ? t('column.less') : t('column.more', { count: String(hidden) }),
          )
          : null,
      ),
  );
}

/**
 * The team roster, always on screen in every layout: one avatar per member,
 * opening that member's panel. The board is the only place the whole team is
 * visible at once, and the panel must be reachable from it whatever the
 * current layout shows.
 * @param {object} props - component props.
 * @param {Array<object>} props.members - the roster members.
 * @param {Record<string, string>} props.assignments - the pinned avatar glyphs.
 * @param {Function} props.onInspect - opens a member's panel.
 * @param {Function} props.t - the bound translator.
 * @returns the roster element tree.
 */
function RosterStrip({ members, assignments, onInspect, t }) {
  if (members.length === 0) return null;
  return h(
    'div',
    { className: 'atb-roster', role: 'list', 'aria-label': t('roster.label') },
    members.map((member) => h(
      'button',
      {
        key: member.id,
        type: 'button',
        role: 'listitem',
        className: 'atb-rosterButton',
        title: t('member.avatar'),
        'aria-label': `${t('member.avatar')} ${member.name}`,
        onClick: () => { onInspect(member.id); },
      },
      h(Avatar, { name: member.name, glyphId: assignments[member.name], size: 22 }),
      h('span', { className: 'atb-rosterName' }, member.name),
    )),
  );
}

/**
 * Build the address of one file read through a Session.
 * @param {string} sessionId - the Session whose workspace resolves the path.
 * @param {string} path - a workspace-relative path.
 * @returns {string} the `dsh-resource://file/session/…` address.
 */
function fileAddressFor(sessionId, path) {
  const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  const encoded = normalized.split('/').map((segment) => encodeURIComponent(segment).replace(/%3A/gi, ':')).join('/');
  return `dsh-resource://file/session/${encodeURIComponent(sessionId)}/${encoded}`;
}

/**
 * One member's detail panel: who they are, what they are responsible for,
 * and what they produced.
 * @param {object} props - component props.
 * @param {object} props.member - the projected member.
 * @param {string} props.status - the member's displayed status.
 * @param {string} [props.model] - the member's model.
 * @param {string} [props.duty] - the responsibility recorded for the member.
 * @param {string} [props.brief] - the member's full assignment brief.
 * @param {Array<object>} props.tasks - the tasks this member owns.
 * @param {Array<object>} props.steps - the member's recorded result steps.
 * @param {object} [props.stats] - the member's session statistics.
 * @param {object} [props.usage] - the member's token usage projection.
 * @param {object} [props.artifacts] - the files the member produced.
 * @param {string} [props.cwd] - the directory the member worked in.
 * @param {string} [props.glyphId] - the avatar glyph pinned to this member.
 * @param {Function} props.onAssign - pins a different avatar glyph.
 * @param {Function} props.onClose - closes the panel.
 * @param {Function} props.onOpenConversation - opens the member's conversation.
 * @param {Function} props.onOpenFile - opens one of the member's files.
 * @param {Function} props.t - the bound translator.
 * @returns the panel element tree.
 */
function MemberPanel({
  member,
  status,
  model,
  duty,
  brief,
  tasks,
  steps,
  stats,
  usage,
  artifacts,
  cwd,
  glyphId,
  onAssign,
  onClose,
  onOpenConversation,
  onOpenFile,
  t,
}) {
  const [briefOpen, setBriefOpen] = useState(false);
  // The record can be long; the newest entries stay on screen until the user
  // asks for the rest.
  const [stepsExpanded, setStepsExpanded] = useState(false);
  const stepList = steps ?? [];
  const shownSteps = stepsExpanded ? stepList : stepList.slice(0, COLLAPSE_LIMIT);
  const hiddenSteps = stepList.length - shownSteps.length;
  // What this member's turns cost, split the way the host counts it.
  const buckets = tokenBuckets(usage);
  const durationMs = (stats?.llmMs ?? 0) + (stats?.toolMs ?? 0);
  const cacheHit = buckets.total === 0 ? 0 : Math.round((buckets.cacheRead / buckets.total) * 100);
  const files = [];
  for (const task of tasks ?? []) {
    for (const scope of task.writeScopes ?? []) {
      if (!files.includes(scope)) files.push(scope);
    }
  }
  return h(
    'aside',
    { className: 'atb-panel', 'aria-label': member.name },
    h(
      'div',
      { className: 'atb-panelHead' },
      h(Avatar, { name: member.name, glyphId, size: 34 }),
      h(
        'div',
        { className: 'atb-panelIdentity' },
        h('span', { className: 'atb-panelName' }, member.name),
        h(
          'span',
          { className: 'atb-panelMeta' },
          `${t(member.role === 'lead' ? 'role.lead' : 'role.teammate')} · ${t(`memberStatus.${status}`)}${model == null ? '' : ` · ${model}`}`,
        ),
        stats == null
          ? null
          : h('span', { className: 'atb-panelMeta' }, t('panel.workload', { turns: stats.turns ?? 0, steps: stats.steps ?? 0 })),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'atb-panelClose',
          title: t('panel.close'),
          'aria-label': t('panel.close'),
          onClick: () => { onClose(); },
        },
        '×',
      ),
    ),
    h(
      'div',
      { className: 'atb-panelBody' },
      h(
        'section',
        { className: 'atb-section' },
        h('h3', { className: 'atb-sectionTitle' }, t('panel.duty')),
        duty == null || duty === ''
          ? h('p', { className: 'atb-dutyMuted' }, t('panel.dutyMissing'))
          : h('p', { className: 'atb-duty' }, duty),
        brief == null || brief === ''
          ? null
          : h(
            'div',
            null,
            h(
              'button',
              {
                type: 'button',
                className: 'atb-link',
                onClick: () => { setBriefOpen((value) => !value); },
              },
              t(briefOpen ? 'panel.brief.collapse' : 'panel.brief.expand'),
            ),
            briefOpen ? h('div', { className: 'atb-brief' }, brief) : null,
          ),
        h(
          'div',
          { className: 'atb-picker' },
          h(
            'button',
            {
              type: 'button',
              className: glyphId === undefined ? 'atb-pickerAuto atb-pickerButtonActive' : 'atb-pickerAuto',
              onClick: () => { onAssign(undefined); },
            },
            t('panel.avatar.auto'),
          ),
          GLYPHS.map((glyph) => h(
            'button',
            {
              key: glyph.id,
              type: 'button',
              title: glyph.label,
              'aria-label': glyph.label,
              className: glyphId === glyph.id ? 'atb-pickerButton atb-pickerButtonActive' : 'atb-pickerButton',
              onClick: () => { onAssign(glyph.id); },
            },
            h(Avatar, { name: member.name, glyphId: glyph.id, size: 22 }),
          )),
        ),
      ),
      h(
        'section',
        { className: 'atb-section' },
        h('h3', { className: 'atb-sectionTitle' }, `${t('panel.tasks')} · ${tasks.length}`),
        tasks.length === 0
          ? h('p', { className: 'atb-dutyMuted' }, '—')
          : h(
            'div',
            { className: 'atb-panelList' },
            tasks.map((task) => h(
              'div',
              { key: task.id, className: 'atb-panelTask' },
              h('span', { className: 'atb-panelTaskTitle' }, task.subject),
              h(
                'span',
                { className: 'atb-panelTaskMeta' },
                h('span', { className: statusPillClass(task.status) },
        h(StatusMark, { status: task.status, size: 11 }),
        t(`status.${task.status}`)),
                task.description == null || task.description === ''
                  ? null
                  : h('span', {}, task.description.length > 120 ? `${task.description.slice(0, 120)}…` : task.description),
              ),
            )),
          ),
      ),
      h(
        'section',
        { className: 'atb-section' },
        h('h3', { className: 'atb-sectionTitle' }, t('panel.tokens')),
        buckets.total === 0
          ? h('p', { className: 'atb-dutyMuted' }, t('panel.tokens.missing'))
          : h(
            'div',
            null,
            h('p', { className: 'atb-tokenTotal' }, t('panel.tokens.total', { count: formatTokens(buckets.total) })),
            h(
              'p',
              { className: 'atb-tokenLine' },
              `${t('panel.tokens.input')} ${formatTokens(buckets.uncached)} · ${t('panel.tokens.output')} ${formatTokens(buckets.output)} · ${t('panel.tokens.cache')} ${formatTokens(buckets.cacheRead)}`,
            ),
            h('p', { className: 'atb-tokenLine' }, t('panel.tokens.cacheHit', { percent: String(cacheHit) })),
            h('p', { className: 'atb-tokenLine' }, t('panel.duration', { duration: formatDuration(durationMs) })),
          ),
      ),
      h(
        'section',
        { className: 'atb-section' },
        h('h3', { className: 'atb-sectionTitle' }, `${t('panel.artifacts')} · ${artifacts?.files?.length ?? 0}`),
        artifacts?.state === 'loading'
          ? h('p', { className: 'atb-dutyMuted' }, t('panel.artifacts.loading'))
          : (artifacts?.files?.length ?? 0) === 0
            ? h('p', { className: 'atb-dutyMuted' }, t(artifacts?.state === 'failed' ? 'panel.artifacts.failed' : 'panel.artifacts.empty'))
            : h(
              'div',
              { className: 'atb-files' },
              artifacts.files.map((artifact) => h(
                'button',
                {
                  key: artifact.path,
                  type: 'button',
                  className: 'atb-file',
                  title: artifact.path,
                  onClick: () => { onOpenFile(member.id, relativeToCwd(cwd, artifact.path)); },
                },
                h('span', { className: 'atb-filePath' }, relativeToCwd(cwd, artifact.path)),
              )),
            ),
      ),
      h(
        'section',
        { className: 'atb-section' },
        h('h3', { className: 'atb-sectionTitle' }, `${t('panel.results')} · ${stepList.length}`),
        stepList.length === 0
          ? h('p', { className: 'atb-dutyMuted' }, t('panel.results.missing'))
          : h(
            'div',
            null,
            h('p', { className: 'atb-subTitle' }, t('panel.steps')),
            h(
              'ul',
              { className: 'atb-steps' },
              shownSteps.map((step, index) => h(
                'li',
                {
                  key: `${step.content}`,
                  className: step.status === 'completed' ? 'atb-step' : 'atb-step atb-stepPending',
                },
                h(StatusMark, { status: step.status }),
                h('span', {}, step.content),
              )),
            ),
            stepList.length > COLLAPSE_LIMIT
              ? h(
                'button',
                {
                  type: 'button',
                  className: 'atb-fold',
                  onClick: () => { setStepsExpanded((value) => !value); },
                },
                stepsExpanded ? t('column.less') : t('column.more', { count: String(hiddenSteps) }),
              )
              : null,
          ),
        files.length === 0
          ? null
          : h(
            'div',
            null,
            h('p', { className: 'atb-subTitle' }, t('panel.files')),
            h(
              'div',
              { className: 'atb-files' },
              files.map((file) => h(
                'button',
                {
                  key: file,
                  type: 'button',
                  className: 'atb-file',
                  title: file,
                  onClick: () => { onOpenFile(member.id, file); },                },
                h('span', { className: 'atb-filePath' }, file),
              )),
            ),
          ),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'atb-panelAction',
          onClick: () => { onOpenConversation(member.id); },
        },
        t('panel.open'),
      ),
    ),
  );
}

/**
 * The board itself: the Agent Team roster and the shared task board, read
 * from the Lead Session's `agentTeam` projection.
 * @param {object} props - component props.
 * @param {string} props.sessionId - the current Session id.
 * @param {Function} props.useSession - the standard session hook.
 * @param {Function} props.useSessions - the standard sessions hook.
 * @param {Function} props.useSessionStatus - the standard status hook.
 * @param {Function} props.t - the bound translator.
 * @param {object} props.ctx - the client plugin context, for navigation.
 * @returns the board element tree.
 */
function TeamBoardView({ ctx, sessionId, useSession, useSessions, useSessionStatus, t }) {
  const [layout, setLayout] = useState('member');
  const [selectedId, setSelectedId] = useState(null);
  const [assignments, setAssignments] = useState(() => readAssignments());
  // A teammate conversation reports its Lead through the subagent address, so
  // the board always reads the Lead's roster.
  const leadSessionId = useSession((snapshot) => snapshot.subagent?.address.parentSessionId) ?? sessionId;
  const team = useSessions((state) => state.projectionsBySession[leadSessionId]?.values.agentTeam);
  const opening = useSession((snapshot) => snapshot.openState === 'loading');
  const listing = useSessions((state) => state.phase === 'pending');

  const members = team?.members ?? [];
  const tasks = team?.tasks ?? [];
  // Every member's own task list. The board shows both kinds of work: the
  // shared task board the team maintains, and the list each teammate kept of
  // what it was asked to do.
  const byId = useSessions((state) => state.byId);
  // The complete task record of every member. The `todos` projection carries
  // the round that is running; the Host reads the session log for the rounds
  // before it, so the record survives the start of a new round.
  const [histories, setHistories] = useState({});
  const memberKey = members.map((member) => member.id).join(',');
  useEffect(() => {
    let cancelled = false;
    const wanted = members.filter((member) => {
      const cached = historyCache.get(member.id);
      return cached === undefined || Date.now() - cached.at >= HISTORY_TTL_MS;
    });
    if (wanted.length === 0) return undefined;
    setHistories((previous) => {
      const next = { ...previous };
      for (const member of wanted) next[member.id] = { state: 'loading', items: [] };
      return next;
    });
    Promise.all(wanted.map(async (member) => {
      try {
        const items = await fetchTodoHistory(member.id);
        return [member.id, { state: 'ready', items }];
      } catch {
        return [member.id, { state: 'failed', items: [] }];
      }
    })).then((entries) => {
      if (cancelled) return;
      setHistories((previous) => ({ ...previous, ...Object.fromEntries(entries) }));
    });
    return () => { cancelled = true; };
  }, [memberKey]);
  const memberSteps = useMemo(
    () => members.map((member) => ({
      member,
      steps: mergeTaskItems(byId?.[member.id]?.projectionValues?.todos, histories[member.id]?.items),
    })),
    [members, byId, histories],
  );
  // The Lead is never in the catalog, so it gets a duty of its own instead of
  // being reported as a member without a responsibility.
  const leadDuty = t(members.length <= 1 ? 'role.lead.solo' : 'role.lead.duty', { count: members.length });
  const memberColumns = useMemo(
    () => members.map((member) => ({
      member,
      tasks: tasks.filter((task) => task.ownerName === member.name),
    })),
    [members, tasks],
  );
  const unassigned = useMemo(
    () => tasks.filter((task) => task.ownerName === undefined),
    [tasks],
  );
  // The status layout groups the whole team's work: shared tasks by their
  // status, and each member's task items by theirs.
  const statusColumns = useMemo(
    () => STATUS_ORDER.map((status) => ({
      status,
      tasks: tasks.filter((task) => task.status === status),
      steps: memberSteps.flatMap(({ member, steps: list }) => list
        .filter((step) => (step.status ?? 'pending') === status)
        .map((step) => ({ member, step }))),
    })),
    [tasks, memberSteps],
  );
  const taskItems = tasks.length + memberSteps.reduce((count, entry) => count + entry.steps.length, 0);
  const activeTasks = useMemo(
    () => tasks.filter((task) => task.status === 'in_progress').length
      + memberSteps.reduce(
        (count, entry) => count + entry.steps.filter((step) => step.status === 'in_progress').length,
        0,
      ),
    [tasks, memberSteps],
  );
  // The selected member's own record: the roster row, its responsibility, the
  // assignment brief it was started with, and the steps it reported.
  const selected = selectedId === null
    ? undefined
    : members.find((member) => member.id === selectedId);
  const duty = useSessions((state) => {
    if (selectedId === null) return undefined;
    const catalog = state.projectionsBySession[leadSessionId]?.values.subagentCatalog;
    const child = catalog?.find((entry) => entry.id === selectedId);
    if (child?.label !== undefined && child.label !== '') return child.label;
    return state.byId[selectedId]?.projectionValues?.subagent?.identity?.label;
  });
  const brief = useSessions((state) => (selectedId === null
    ? undefined
    : state.byId[selectedId]?.projectionValues?.titleInput?.first?.text));
  // The selected member's complete task record: the running round's list plus
  // what earlier rounds recorded.
  const steps = useMemo(
    () => (selectedId === null
      ? undefined
      : memberSteps.find((entry) => entry.member.id === selectedId)?.steps ?? []),
    [selectedId, memberSteps],
  );
  const stats = useSessions((state) => (selectedId === null
    ? undefined
    : state.byId[selectedId]?.projectionValues?.sessionStats));
  const selectedUsage = useSessions((state) => (selectedId === null
    ? undefined
    : state.byId[selectedId]?.projectionValues?.tokenUsage));
  // The sequence of the member's last completed step: the upper bound the
  // host's journal reads the member's history up to.
  const artifactHint = useSessions((state) => {
    if (selectedId === null) return 0;
    const boundary = state.byId?.[selectedId]?.projectionValues?.turnBoundary;
    return boundary?.lastStepBoundary?.seq ?? boundary?.lastStepStartSeq ?? 0;
  });
  const selectedCwd = useSessions((state) => (selectedId === null
    ? undefined
    : state.byId?.[selectedId]?.cwd));
  // What the member actually produced, read from its own session log.
  const [artifacts, setArtifacts] = useState({ state: 'idle', files: [] });
  useEffect(() => {
    if (selectedId === null) {
      setArtifacts({ state: 'idle', files: [] });
      return undefined;
    }
    let cancelled = false;
    setArtifacts({ state: 'loading', files: [] });
    readMemberArtifacts(ctx, selectedId, artifactHint)
      .then((files) => {
        if (!cancelled) setArtifacts({ state: 'ready', files });
      })
      .catch(() => {
        if (!cancelled) setArtifacts({ state: 'failed', files: [] });
      });
    return () => { cancelled = true; };
  }, [ctx, selectedId, artifactHint]);
  // What the whole roster cost, so the summary bar can say it next to the
  // work counts. The Lead is a member of the roster, so its own context
  // counts in.
  const teamTokens = useMemo(
    () => members.reduce(
      (sum, member) => sum + tokenBuckets(byId?.[member.id]?.projectionValues?.tokenUsage).total,
      0,
    ),
    [members, byId],
  );
  const panelDuty = duty === undefined || duty === null || duty === ''
    ? (selected?.role === 'lead' ? leadDuty : duty)
    : duty;
  const selectedModel = useSessions((state) => (selectedId === null
    ? undefined
    : state.projectionsBySession[selectedId]?.values.modelSelection?.next?.model));
  const selectedRunning = useSessionStatus((state) => (selectedId === null
    ? undefined
    : state.get(selectedId)?.running));
  const selectedSummaryRunning = useSessions((state) => (selectedId === null
    ? undefined
    : state.byId[selectedId]?.running));
  const selectedStatus = selected === undefined
    ? undefined
    : selected.phase === 'active'
      ? (selectedRunning ?? selectedSummaryRunning) === true ? 'running' : 'inactive'
      : selected.phase;
  const selectedTasks = useMemo(
    () => (selected === undefined ? [] : tasks.filter((task) => task.ownerName === selected.name)),
    [selected, tasks],
  );

  // Escape closes the member panel.
  useEffect(() => {
    if (selectedId === null) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setSelectedId(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); };
  }, [selectedId]);

  const assign = useCallback((name, glyphId) => {
    writeAssignment(name, glyphId);
    setAssignments(readAssignments());
  }, []);

  if (team === undefined) {
    return h(
      'div',
      { className: 'atb-root' },
      h(
        'div',
        { className: 'atb-notice' },
        h('div', { role: 'status' }, t(opening || listing ? 'board.loading' : 'board.unavailable')),
        opening || listing ? null : h('div', {}, t('board.hint')),
      ),
    );
  }

  return h(
    'div',
    { className: 'atb-root' },
    h(
      'div',
      { className: 'atb-bar' },
      h('span', { className: 'atb-title' }, t('view.label')),
      h(
        'div',
        { className: 'atb-layout', role: 'group' },
        h(
          'button',
          {
            type: 'button',
            className: layout === 'member' ? 'atb-layoutButton atb-layoutButtonActive' : 'atb-layoutButton',
            onClick: () => { setLayout('member'); },
          },
          t('layout.member'),
        ),
        h(
          'button',
          {
            type: 'button',
            className: layout === 'status' ? 'atb-layoutButton atb-layoutButtonActive' : 'atb-layoutButton',
            onClick: () => { setLayout('status'); },
          },
          t('layout.status'),
        ),
      ),
      h(
        'div',
        { className: 'atb-stats' },
        h('span', { className: 'atb-stat' }, t('summary.members', { count: members.length })),
        h('span', { className: 'atb-stat' }, t('summary.tasks', { count: taskItems })),
        h('span', { className: 'atb-stat' }, t('summary.active', { count: activeTasks })),
        h('span', { className: 'atb-stat' }, t('summary.tokens', { count: formatTokens(teamTokens) })),
      ),
    ),
    team.failure === undefined
      ? null
      : h('div', { className: 'atb-error', role: 'alert' }, t('board.failure', { message: team.failure })),
    h(RosterStrip, {
      members,
      assignments,
      onInspect: (memberId) => { setSelectedId(memberId); },
      t,
    }),
    layout === 'status' && taskItems === 0
      ? h('p', { className: 'atb-hint' }, t('board.noSharedTasks'))
      : null,
    h(
      'div',
      { className: 'atb-board' },
      layout === 'member'
        ? [
          ...memberColumns.map((column) => h(MemberColumn, {
            key: column.member.id,
            member: column.member,
            tasks: column.tasks,
            steps: memberSteps.find((entry) => entry.member.id === column.member.id)?.steps ?? [],
            historyState: histories[column.member.id]?.state,
            leadDuty,
            useSessionStatus,
            useSessions,
            onOpen: (memberId) => { openMember(ctx, sessionId, memberId); },
            onInspect: (memberId) => { setSelectedId(memberId); },
            leadSessionId,
            glyphId: assignments[column.member.name],
            t,
          })),
          unassigned.length === 0
            ? null
            : h(
              'section',
              { key: 'unassigned', className: columnClass(hasWorkInProgress(unassigned)) },
              h(
                'div',
                { className: 'atb-columnHead' },
                h('span', { className: 'atb-dot', 'aria-hidden': 'true' }),
                h('span', { className: 'atb-columnName' }, t('column.unassigned')),
                h('span', { className: 'atb-columnCount' }, String(unassigned.length)),
              ),
              h(
                'div',
                { className: 'atb-cards' },
                unassigned.map((task) => h(TaskCard, { key: task.id, task, t })),
              ),
            ),
        ]
        : statusColumns.map((column) => h(StatusColumn, {
          key: column.status,
          status: column.status,
          tasks: column.tasks,
          steps: column.steps,
          assignments,
          onInspect: (memberId) => { setSelectedId(memberId); },
          t,
        })),
    ),
    selected === undefined
      ? null
      : h(
        'div',
        { className: 'atb-scrim', onClick: () => { setSelectedId(null); } },
      ),
    selected === undefined
      ? null
      : h(
        MemberPanel,
        {
          member: selected,
          status: selectedStatus,
          model: selectedModel,
          duty: panelDuty,
          brief,
          tasks: selectedTasks,
          steps,
          stats,
          usage: selectedUsage,
          artifacts,
          cwd: selectedCwd,
          glyphId: assignments[selected.name],
          onAssign: (glyphId) => { assign(selected.name, glyphId); },
          onClose: () => { setSelectedId(null); },
          onOpenConversation: (memberId) => { openMember(ctx, sessionId, memberId); },
          onOpenFile: (memberId, file) => { openMemberFile(ctx, memberId, file); },
          t,
        },
      ),
  );
}

/**
 * Open one member's conversation.
 * @param {object} ctx - the client plugin context.
 * @param {string} sessionId - the Session the board is shown in.
 * @param {string} memberId - the member Session to open.
 */
function openMember(ctx, sessionId, memberId) {
  try {
    const workspace = ctx.get('uiWorkspace');
    const sessions = ctx.get('sessions');
    if (workspace === undefined || typeof workspace.openSession !== 'function') return;
    const parentSessionId = sessions?.binding?.(sessionId)?.session.getSnapshot().subagent?.address?.parentSessionId ?? sessionId;
    if (memberId === parentSessionId) {
      workspace.openSession(parentSessionId);
      return;
    }
    workspace.openSession({ parentSessionId, childSessionId: memberId, mode: 'continuable' });
  } catch (error) {
    console.warn('[agent-team-board] opening a member conversation failed: ' + (error instanceof Error ? error.message : String(error)));
  }
}

/**
 * Open one of a member's files in the right sidebar.
 * @param {object} ctx - the client plugin context.
 * @param {string} memberId - the member Session that owns the file.
 * @param {string} file - the workspace-relative path.
 */
function openMemberFile(ctx, memberId, file) {
  try {
    const sidebar = ctx.get('sidebarRight');
    if (sidebar === undefined || typeof sidebar.openResource !== 'function') return;
    sidebar.openResource(fileAddressFor(memberId, file));
  } catch (error) {
    console.warn('[agent-team-board] opening a member file failed: ' + (error instanceof Error ? error.message : String(error)));
  }
}

/** Services this board needs: the slot registry, the locale seat, and navigation. */
export const inject = ['slots', 'locale', 'sessions', 'uiWorkspace', 'sidebarRight'];

/**
 * Register the Team Board as a Conversation View.
 * @param {object} ctx - the client plugin context.
 */
export function apply(ctx) {
  const t = ctx.locale.bind(NS);
  // One failed registration (a duplicate after an HMR reload) must not abort the rest.
  const rawEffect = ctx.effect.bind(ctx);
  const register = (build, label) => rawEffect(() => {
    try {
      return build();
    } catch (error) {
      console.warn('[agent-team-board] ' + label + ' failed: ' + (error instanceof Error ? error.message : String(error)));
      return undefined;
    }
  }, label);

  register(() => ctx.locale.register(NS, { zh, en }), 'agent-team-board: dictionaries');
  register(() => installStyles(), 'agent-team-board: styles');
  register(() => {
    // A hot reload swaps the plugin fiber, which can leave the previous
    // registration behind. Retiring it first keeps one live entry, so the tab
    // never points at a registration that cannot render.
    const previous = globalThis[REGISTRATION_KEY];
    if (typeof previous === 'function') {
      try {
        previous();
      } catch (error) {
        console.warn('[agent-team-board] retiring the previous registration failed: ' + (error instanceof Error ? error.message : String(error)));
      }
      globalThis[REGISTRATION_KEY] = undefined;
    }
    const dispose = ctx.slots.inject('conversation.view', () => ctx.slots.register({
      name: 'conversation.view',
      id: VIEW_ID,
      order: VIEW_ORDER,
      locale: NS,
      label: () => t('view.label'),
    }, (props) => h(TeamBoardView, { ctx, ...props })));
    globalThis[REGISTRATION_KEY] = dispose;
    return dispose;
  }, 'agent-team-board: view');
}
