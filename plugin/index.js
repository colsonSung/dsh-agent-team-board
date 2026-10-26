/**
 * Host half of the Agent Team Board bundle.
 *
 * The board itself is a pure Client feature: it reads the Lead Session's
 * `agentTeam` projection from the shared Session store and renders it on the
 * `conversation.view` slot.
 *
 * This half adds the one thing the Client cannot reach on its own: the task
 * record of a Session across all of its rounds. The `todos` projection only
 * carries the list of the round that is running, so a member that finished
 * three rounds ago looks empty on the board. The Host reads the Session log
 * and answers with every item that Session ever recorded, so the browser
 * receives a few kilobytes instead of the whole log.
 */

/** The route the Client half reads one Session's task record from. */
export const HISTORY_ROUTE = '/api/agent-team-board/history'

/** How long one Session's task record stays fresh in the Host. */
export const HISTORY_TTL_MS = 15_000

/**
 * Merge one Session's todo writes into its complete task record.
 *
 * A `todo/write` event replaces the whole list, so the record is the union of
 * every list the Session wrote: an item counts once, and the last write that
 * mentioned it decides its status.
 * @param {Array<object>} events - the Session's events.
 * @param {number} inheritedEventCount - how many leading events were inherited
 *   from a parent Session; those belong to the parent, not to this one.
 * @returns {{ writes: number, items: Array<object> }} the merged record.
 */
export function mergeTodoHistory(events, inheritedEventCount = 0) {
  const items = new Map()
  let writes = 0
  for (const event of events ?? []) {
    if (event?.type !== 'todo/write') continue
    if (typeof event.seq === 'number' && event.seq < inheritedEventCount) continue
    const todos = Array.isArray(event.data?.todos) ? event.data.todos : []
    writes += 1
    for (const todo of todos) {
      const content = typeof todo?.content === 'string' ? todo.content : ''
      if (content === '') continue
      items.set(content, {
        content,
        status: todo.status === 'completed'
          ? 'completed'
          : todo.status === 'in_progress' ? 'in_progress' : 'pending',
        seq: typeof event.seq === 'number' ? event.seq : 0,
        time: typeof event.time === 'number' ? event.time : 0,
      })
    }
  }
  return {
    writes,
    items: [...items.values()].sort((left, right) => right.seq - left.seq),
  }
}

/**
 * Read one Session's complete task record from its log.
 * @param {any} ctx - the plugin context.
 * @param {string} sessionId - the Session to read.
 * @returns {Promise<{ sessionId: string, writes: number, items: Array<object> }>}
 */
export async function readTodoHistory(ctx, sessionId) {
  const sessionQuery = ctx.get('sessionQuery')
  if (sessionQuery === undefined) {
    return { sessionId, writes: 0, items: [], error: 'no-session-query' }
  }
  const observation = await sessionQuery.observeSession(sessionId, { projectionMode: 'none' })
  try {
    const merged = mergeTodoHistory(observation.events, observation.inheritedEventCount ?? 0)
    return { sessionId, writes: merged.writes, items: merged.items }
  } finally {
    observation[Symbol.dispose]?.()
  }
}

/**
 * Register the board plugin.
 * @param {any} ctx - the plugin context.
 */
export function apply(ctx) {
  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.effect(() => {
      /** The answers already computed, keyed by Session id. */
      const cache = new Map()
      /** @type {Array<() => void>} */
      const disposers = []
      try {
        disposers.push(connectionCtx.connection.fetch.register({
          path: HISTORY_ROUTE,
          methods: ['GET'],
          requestBody: 'buffered',
          fetch: async (request) => {
            const url = new URL(request?.url ?? 'http://localhost/')
            const sessionId = url.searchParams.get('sessionId') ?? ''
            // A Lead Session carries the `session-` prefix; a teammate's own
            // Session id is a bare identifier.
            if (!/^(session-)?[0-9a-z][0-9a-z-]{7,}$/i.test(sessionId)) {
              return Response.json(
                { error: 'bad-session', items: [] },
                { status: 400, headers: { 'cache-control': 'no-store' } },
              )
            }
            const cached = cache.get(sessionId)
            if (cached !== undefined && Date.now() - cached.at < HISTORY_TTL_MS) {
              return Response.json(cached.value, { headers: { 'cache-control': 'no-store' } })
            }
            let value
            try {
              value = await readTodoHistory(ctx, sessionId)
            } catch (error) {
              // A Session that cannot be read is not a failure of the board:
              // the Client keeps whatever its projection already holds.
              value = {
                sessionId,
                writes: 0,
                items: [],
                error: String(error instanceof Error ? error.message : error),
              }
            }
            cache.set(sessionId, { at: Date.now(), value })
            return Response.json(value, { headers: { 'cache-control': 'no-store' } })
          },
        }))
      } catch (error) {
        ctx.logger.warn(`agent-team-board: the history route could not be registered: ${String(error)}`)
      }
      return () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {
            /* a route that is already gone is not a problem */
          }
        }
      }
    }, 'agent-team-board: /api/agent-team-board/history')
  })
}
