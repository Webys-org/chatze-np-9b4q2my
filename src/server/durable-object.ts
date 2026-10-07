// ============================================================================
// Cloudflare Durable Object: RealtimeBroadcaster (Zero-Polling Cross-Isolate Hub)
// ============================================================================
export class RealtimeBroadcaster {
  state: any
  env: any
  sessions: Set<ReadableStreamDefaultController>

  constructor(state: any, env: any) {
    this.state = state
    this.env = env
    this.sessions = new Set()

    // Pure TCP ping every 15s to keep connections alive: ZERO database queries!
    setInterval(() => {
      if (this.sessions.size > 0) {
        const pingPayload = new TextEncoder().encode(`: ping\n\nevent: ping\ndata: {"t":${Date.now()}}\n\n`)
        for (const controller of Array.from(this.sessions)) {
          try {
            controller.enqueue(pingPayload)
          } catch {
            this.sessions.delete(controller)
          }
        }
      }
    }, 15000)
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Broadcast event across all connected clients on any device/isolate in 0ms!
    if (url.pathname === '/broadcast') {
      try {
        const body: any = await request.json()
        const eventName = body.event || 'new_message'
        const eventData = typeof body.data === 'string' ? body.data : JSON.stringify(body.data)
        const chunk = new TextEncoder().encode(`event: ${eventName}\ndata: ${eventData}\n\n`)

        for (const controller of Array.from(this.sessions)) {
          try {
            controller.enqueue(chunk)
          } catch {
            this.sessions.delete(controller)
          }
        }
        return new Response(JSON.stringify({ success: true, count: this.sessions.size }), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400 })
      }
    }

    // Connect SSE client into global room
    if (url.pathname === '/stream') {
      let clientController: ReadableStreamDefaultController
      const stream = new ReadableStream({
        start: (controller) => {
          clientController = controller
          this.sessions.add(controller)
          // Initial flush with comment to prevent mobile browser proxy buffering
          const welcome = new TextEncoder().encode(': ok\n\nevent: connected\ndata: {"status":"connected","source":"durable_object"}\n\n')
          controller.enqueue(welcome)
        },
        cancel: () => {
          this.sessions.delete(clientController)
        },
      })

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
          'Access-Control-Allow-Origin': '*',
        },
      })
    }

    return new Response('Not Found', { status: 404 })
  }
}
