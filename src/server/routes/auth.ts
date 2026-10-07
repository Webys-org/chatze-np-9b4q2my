import { Hono } from 'hono'
import { ensureD1Database } from '../db'
import { ensureServerKeyPair } from '../crypto'
import { memoryStore, createSession, validateSession } from '../store'
import type { Bindings, MemUser } from '../types'

const authRoutes = new Hono<{ Bindings: Bindings }>()

authRoutes.get('/api/setup/status', async (c) => {
  const db = c.env?.DB

  if (db) {
    try {
      await ensureD1Database(db)
      const setupRow: any = await db.prepare("SELECT value FROM system_config WHERE key = 'is_setup'").first()
      const nameRow: any = await db.prepare("SELECT value FROM system_config WHERE key = 'display_name'").first()
      const hasAdmin: any = await db.prepare("SELECT id FROM users LIMIT 1").first()

      const isSetup = setupRow?.value === 'true' && Boolean(hasAdmin)
      return c.json({
        setupRequired: !isSetup,
        displayName: nameRow?.value || 'Chatze User',
      })
    } catch (d1Err: any) {
      console.warn('[D1 Setup Status Warning, falling back to memory]', d1Err?.message)
    }
  }

  const isSetup = memoryStore.config.get('is_setup') === 'true' && memoryStore.users.size > 0
  return c.json({
    setupRequired: !isSetup,
    displayName: memoryStore.config.get('display_name') || 'Chatze User',
  })
})

authRoutes.post('/api/setup', async (c) => {
  try {
    const body = await c.req.json()
    const displayName = (body.displayName || body.businessName || 'Chatze User').trim()
    const cleanHandle = (body.adminUsername || body.username || 'admin').replace(/^@/, '').trim().toLowerCase()
    const password = body.password || 'admin123'
    const adminId = 'usr_admin_' + Math.random().toString(36).slice(2, 9)
    const now = Date.now()
    const db = c.env?.DB

    // Sync in-memory store
    memoryStore.config.set('is_setup', 'true')
    memoryStore.config.set('display_name', displayName)
    const newAdmin: MemUser = {
      id: adminId,
      handle: cleanHandle,
      display_name: displayName,
      password_hash: password,
      role: 'admin',
      created_at: now,
    }
    memoryStore.users.set(adminId, newAdmin)

    // Save in D1 if available
    if (db) {
      try {
        await ensureD1Database(db)
        await db.prepare("INSERT OR REPLACE INTO system_config (key, value) VALUES ('is_setup', 'true'), ('display_name', ?)")
          .bind(displayName).run()
        await db.prepare("INSERT OR REPLACE INTO users (id, handle, display_name, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'admin', ?)")
          .bind(adminId, cleanHandle, displayName, password, now).run()
        await ensureServerKeyPair(db)
      } catch (d1Err: any) {
        console.warn('[D1 Setup Save Warning]', d1Err?.message)
      }
    }

    const sessionToken = await createSession(adminId, db)

    return c.json({
      success: true,
      token: sessionToken,
      user: {
        id: adminId,
        handle: cleanHandle,
        display_name: displayName,
        role: 'admin',
      },
    })
  } catch (err: any) {
    return c.json({ error: err.message || 'Setup failed' }, 400)
  }
})

authRoutes.get('/api/auth/session', async (c) => {
  const authHeader = c.req.header('Authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()

  if (!token) {
    return c.json({ user: null, error: 'Unauthorized: No session token provided' }, 401)
  }

  const user = await validateSession(token, c.env?.DB)
  if (user) {
    return c.json({ user })
  }

  return c.json({ user: null, error: 'Unauthorized: Session invalid or expired' }, 401)
})

authRoutes.post('/api/auth/sign-in', async (c) => {
  try {
    const { username, password } = await c.req.json()
    const cleanHandle = (username || '').replace(/^@/, '').trim().toLowerCase()
    const db = c.env?.DB
    let matchedUser: any = null

    if (db) {
      try {
        await ensureD1Database(db)
        const user: any = await db.prepare("SELECT * FROM users WHERE handle = ? OR id = ?").bind(cleanHandle, cleanHandle).first()
        if (user && user.password_hash === password) {
          matchedUser = user
        }
      } catch (d1Err: any) {
        console.warn('[D1 Sign In Warning]', d1Err?.message)
      }
    }

    if (!matchedUser) {
      const match = Array.from(memoryStore.users.values()).find((u) => u.handle.toLowerCase() === cleanHandle && u.password_hash === password)
      if (match) matchedUser = match
    }

    if (matchedUser) {
      const sessionToken = await createSession(matchedUser.id, db)
      const { password_hash, ...safe } = matchedUser
      return c.json({ success: true, token: sessionToken, user: safe })
    }

    return c.json({ error: 'Incorrect username or password' }, 401)
  } catch (err: any) {
    return c.json({ error: err.message || 'Sign in error' }, 500)
  }
})

authRoutes.post('/api/auth/sign-out', async (c) => {
  const authHeader = c.req.header('Authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (token) {
    memoryStore.sessions.delete(token)
    if (c.env?.DB) {
      try {
        await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
      } catch (e) {}
    }
  }
  return c.json({ success: true })
})

export default authRoutes
