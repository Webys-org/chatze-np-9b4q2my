import { ensureD1Database } from './db'
import type {
  MemUser,
  MemSession,
  MemConversation,
  MemMessage,
  MemFriendship,
  MemMedia,
  MemInquiry,
  MemBlockedDomain,
  UserStreamClient,
} from './types'

export const activeStreams = new Map<string, Set<UserStreamClient>>()

export function emitUserEvent(userId: string, eventName: string, payload: any) {
  const clients = activeStreams.get(userId)
  const packet = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`
  if (clients) {
    for (const client of clients) {
      try {
        client.write(packet)
      } catch {
        clients.delete(client)
      }
    }
  }
}

export async function broadcastAllStreams(eventName: string, payload: any, env?: any) {
  // 1. If Cloudflare Durable Object is available, broadcast across ALL global isolates & devices in 0ms!
  if (env?.REALTIME_ROOM) {
    try {
      const id = env.REALTIME_ROOM.idFromName('global_room')
      const stub = env.REALTIME_ROOM.get(id)
      await stub.fetch('http://internal/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: eventName, data: payload }),
      })
    } catch (err: any) {
      console.warn('[DO Broadcast Error]', err?.message)
    }
  }

  // 2. In-memory local isolate broadcast
  const packet = `event: ${eventName}\ndata: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`
  for (const [, clients] of activeStreams) {
    for (const client of clients) {
      try {
        client.write(packet)
      } catch {
        clients.delete(client)
      }
    }
  }
}

export const memoryStore = {
  users: new Map<string, MemUser>(),
  sessions: new Map<string, MemSession>(),
  conversations: new Map<string, MemConversation>(),
  messages: [] as MemMessage[],
  config: new Map<string, string>(),
  friendships: new Map<string, MemFriendship>(),
  media: new Map<string, MemMedia>(),
  inquiries: new Map<string, MemInquiry>(),
  blockedDomains: new Map<string, MemBlockedDomain>(),
}

// Session expiration: 30 days
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000

export async function createSession(userId: string, db?: any): Promise<string> {
  const token = 'tok_' + crypto.randomUUID().replace(/-/g, '')
  const now = Date.now()
  const expiresAt = now + SESSION_DURATION_MS

  memoryStore.sessions.set(token, { userId, createdAt: now, expiresAt })

  if (db) {
    try {
      await ensureD1Database(db)
      await db.prepare('INSERT OR REPLACE INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .bind(token, userId, now, expiresAt).run()
    } catch (e: any) {
      console.warn('[Session Save Warning]', e?.message)
    }
  }

  return token
}

export async function validateSession(token: string, db?: any): Promise<any | null> {
  if (!token) return null
  const now = Date.now()

  if (db) {
    try {
      await ensureD1Database(db)
      const row: any = await db.prepare(`
        SELECT u.id, u.handle, u.display_name, u.role, u.created_at
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.token = ? AND s.expires_at > ?
        LIMIT 1
      `).bind(token, now).first()

      if (row) return row
    } catch (e: any) {
      console.warn('[Session Validate Warning]', e?.message)
    }
  }

  const memSession = memoryStore.sessions.get(token)
  if (memSession && memSession.expiresAt > now) {
    const user = memoryStore.users.get(memSession.userId)
    if (user) {
      const { password_hash, ...safe } = user
      return safe
    }
  }

  return null
}
