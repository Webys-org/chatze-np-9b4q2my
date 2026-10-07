import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { activeStreams } from '../store'
import type { Bindings, UserStreamClient } from '../types'

const streamRoutes = new Hono<{ Bindings: Bindings }>()

// Server-Sent Events Stream (Durable Object Global Room + Zero Polling)
streamRoutes.get('/api/stream', async (c) => {
  // If Cloudflare Durable Object is bound, forward to the singleton cross-isolate room!
  // This delivers messages across ALL isolates, PC, mobile, and tablets in 0 milliseconds!
  if (c.env?.REALTIME_ROOM) {
    try {
      const id = c.env.REALTIME_ROOM.idFromName('global_room')
      const stub = c.env.REALTIME_ROOM.get(id)
      return stub.fetch(new Request('http://internal/stream', {
        headers: c.req.raw.headers,
      }))
    } catch (e: any) {
      console.warn('[DO Stream Route Fallback]', e?.message)
    }
  }

  const userId = c.req.query('userId') || 'usr_admin'

  return streamSSE(c, async (stream) => {
    const clientId = 'client_' + Math.random().toString(36).slice(2, 9)

    const clientRecord: UserStreamClient = {
      id: clientId,
      userId,
      write: (data: string) => {
        stream.write(data)
      },
    }

    if (!activeStreams.has(userId)) {
      activeStreams.set(userId, new Set())
    }
    activeStreams.get(userId)!.add(clientRecord)

    await stream.writeSSE({
      event: 'connected',
      data: JSON.stringify({
        clientId,
        userId,
        timestamp: Date.now(),
        edgeNode: 'Kathmandu (KTM) PoP',
      }),
    })

    // 100% PURE EVENT-DRIVEN SSE (Fallback Mode):
    // Zero D1 reads, zero D1 writes, zero polling!
    // TCP keepalive ping every 12s so socket stays active without database touches.
    const pingInterval = setInterval(async () => {
      try {
        await stream.writeSSE({
          event: 'ping',
          data: JSON.stringify({ t: Date.now() }),
        })
      } catch {
        clearInterval(pingInterval)
        activeStreams.get(userId)?.delete(clientRecord)
      }
    }, 12000)

    stream.onAbort(() => {
      clearInterval(pingInterval)
      activeStreams.get(userId)?.delete(clientRecord)
    })

    // 25s stream lifecycle on fallback to ensure fast reconnection sync if DO is not bound
    await new Promise((resolve) => setTimeout(resolve, 25000))
    clearInterval(pingInterval)
    activeStreams.get(userId)?.delete(clientRecord)
  })
})

export default streamRoutes
