import { Hono } from 'hono'
import { cors } from 'hono/cors'

import type { Bindings } from './types'
import authRoutes from './routes/auth'
import conversationRoutes from './routes/conversations'
import federationRoutes from './routes/federation'
import messagingRoutes from './routes/messaging'
import mediaRoutes from './routes/media'
import pushRoutes from './routes/push'
import streamRoutes from './routes/stream'
import profileRoutes from './routes/profile'
import inquiryRoutes from './routes/inquiries'

export { RealtimeBroadcaster } from './durable-object'
export { emitUserEvent, broadcastAllStreams } from './store'

const app = new Hono<{ Bindings: Bindings }>()

// Global Cross-Origin Middleware
app.use('*', cors())

// Global safety error handler: NEVER return plain text 500
app.onError((err, c) => {
  console.error('[Hono Edge Error]', err)
  return c.json({ error: err.message || 'Server error', timestamp: Date.now() }, 500)
})

// System Health Check
app.get('/api/health', (c) =>
  c.json({
    status: 'ok',
    engine: 'hono-cloudflare-workers',
    edgeNode: 'Kathmandu (KTM) PoP',
    federation: 'enabled',
  })
)

// Mount Modular Routes
app.route('/', authRoutes)
app.route('/', conversationRoutes)
app.route('/', federationRoutes)
app.route('/', messagingRoutes)
app.route('/', mediaRoutes)
app.route('/', pushRoutes)
app.route('/', streamRoutes)
app.route('/', profileRoutes)
app.route('/', inquiryRoutes)

// Fallback to static assets in production on Cloudflare Workers
app.all('*', async (c) => {
  if (c.env?.ASSETS) {
    const res = await c.env.ASSETS.fetch(c.req.raw)
    const url = new URL(c.req.url)
    if (url.pathname.startsWith('/assets/')) {
      const headers = new Headers(res.headers)
      headers.set('Cache-Control', 'public, max-age=31536000, immutable')
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
      })
    }
    return res
  }
  return c.notFound()
})

export default app
