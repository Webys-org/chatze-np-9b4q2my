import { Hono } from 'hono'
import { ensureD1Database } from '../db'
import {
  getOrGenerateVapidKeys,
  sendPushNotification,
  memoryPushSubscriptions,
  StoredSubscription,
} from '../webpush'
import type { Bindings } from '../types'

const pushRoutes = new Hono<{ Bindings: Bindings }>()

// Web Push Notification Subscriptions API (Zero-Polling Background Alerts)
pushRoutes.get('/api/push/vapid-public-key', async (c) => {
  const vapid = await getOrGenerateVapidKeys(c.env)
  return c.json({ publicKey: vapid.publicKey })
})

pushRoutes.post('/api/push/subscribe', async (c) => {
  try {
    const { endpoint, keys, userHandle, userAgent } = await c.req.json()
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return c.json({ error: 'Invalid push subscription payload' }, 400)
    }

    const cleanHandle = (userHandle || 'admin').replace(/^@/, '').trim().toLowerCase()
    const subId = 'sub_' + Math.random().toString(36).slice(2, 10)
    const now = Date.now()

    const subRecord: StoredSubscription = {
      id: subId,
      user_handle: cleanHandle,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: userAgent || 'Browser PWA',
      created_at: now,
    }

    // Save in memory cache
    memoryPushSubscriptions.set(endpoint, subRecord)

    // Save in D1 if available
    const db = c.env?.DB
    if (db) {
      try {
        await ensureD1Database(db)
        await db
          .prepare(
            'INSERT INTO push_subscriptions (id, user_handle, endpoint, p256dh, auth, user_agent, created_at) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?) ' +
            'ON CONFLICT(endpoint) DO UPDATE SET user_handle = excluded.user_handle, p256dh = excluded.p256dh, auth = excluded.auth'
          )
          .bind(subId, cleanHandle, endpoint, keys.p256dh, keys.auth, userAgent || 'Browser PWA', now)
          .run()
      } catch (err: any) {
        console.warn('[D1 Push Subscribe Warning]', err?.message)
      }
    }

    return c.json({ success: true, id: subId }, 201)
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

pushRoutes.post('/api/push/unsubscribe', async (c) => {
  try {
    const { endpoint } = await c.req.json()
    if (!endpoint) return c.json({ error: 'Endpoint required' }, 400)

    memoryPushSubscriptions.delete(endpoint)
    const db = c.env?.DB
    if (db) {
      try {
        await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run()
      } catch {}
    }
    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

pushRoutes.post('/api/push/test', async (c) => {
  try {
    const { userHandle } = await c.req.json().catch(() => ({}))
    const summary = await sendPushNotification(c.env, userHandle || null, {
      title: 'Chatze Notification Test',
      body: '🎉 Notifications working on your device! You will receive alerts when new messages arrive.',
      url: '/',
    })

    return c.json({
      success: summary.successful > 0 || summary.dispatched > 0,
      dispatched: summary.dispatched,
      successful: summary.successful,
      results: summary.results,
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

pushRoutes.get('/api/push/status', async (c) => {
  try {
    const db = c.env?.DB
    let subs: any[] = []
    if (db) {
      try {
        const { results } = await db
          .prepare('SELECT id, user_handle, endpoint, user_agent, created_at FROM push_subscriptions')
          .all()
        if (Array.isArray(results)) subs = results
      } catch {}
    }
    if (subs.length === 0) {
      subs = Array.from(memoryPushSubscriptions.values()).map((s) => ({
        id: s.id,
        user_handle: s.user_handle,
        endpoint: s.endpoint,
        user_agent: s.user_agent,
        created_at: s.created_at,
      }))
    }
    return c.json({
      activeSubscriptions: subs.length,
      subscriptions: subs.map((s) => {
        let domain = 'unknown'
        try {
          domain = new URL(s.endpoint).hostname
        } catch {}
        return {
          id: s.id,
          user_handle: s.user_handle,
          gateway: domain,
          created_at: s.created_at,
        }
      }),
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

export default pushRoutes
