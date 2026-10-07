import { Hono } from 'hono'
import { ensureD1Database } from '../db'
import { memoryStore } from '../store'
import type { Bindings } from '../types'

const conversationRoutes = new Hono<{ Bindings: Bindings }>()

// Conversations & Contact List (WhatsApp Style)
conversationRoutes.get('/api/conversations', async (c) => {
  const db = c.env?.DB

  if (db) {
    try {
      await ensureD1Database(db)
      const convRows: any = await db.prepare('SELECT * FROM conversations ORDER BY last_message_at DESC LIMIT 100').all()
      if (convRows?.results) {
        const mapped = convRows.results.map((row: any) => ({
          id: row.id,
          otherUser: {
            id: row.user_b,
            username: row.remote_handle || row.user_b,
            displayName: row.remote_handle ? `@${row.remote_handle}` : row.user_b,
          },
          status: row.status,
          remoteInstanceUrl: row.remote_instance_url || null,
          lastMessage: row.last_message_snippet
            ? {
                content: row.last_message_snippet,
                createdAt: row.last_message_at,
              }
            : null,
        }))
        return c.json({ conversations: mapped })
      }
    } catch (d1Err: any) {
      console.warn('[D1 Conversations Warning]', d1Err?.message)
    }
  }

  const convList = Array.from(memoryStore.conversations.values())
    .sort((a, b) => b.last_message_at - a.last_message_at)
    .map((conv) => {
      const otherUser = memoryStore.users.get(conv.user_b) || {
        id: conv.user_b,
        handle: conv.remote_handle || conv.user_b,
        display_name: conv.remote_handle ? `@${conv.remote_handle}` : conv.user_b,
      }
      return {
        id: conv.id,
        otherUser: {
          id: otherUser.id,
          username: otherUser.handle,
          displayName: otherUser.display_name,
        },
        status: conv.status,
        remoteInstanceUrl: conv.remote_instance_url || null,
        lastMessage: conv.last_message_snippet
          ? {
              content: conv.last_message_snippet,
              createdAt: conv.last_message_at,
            }
          : null,
      }
    })

  return c.json({ conversations: convList })
})

// Unified Low-Bandwidth Edge Delta-Sync (Single lightweight call for conversations, messages & friendships)
conversationRoutes.get('/api/sync', async (c) => {
  const since = parseInt(c.req.query('since') || '0', 10)
  const conversationId = c.req.query('conversationId') || ''
  const db = c.env?.DB

  let newMessages: any[] = []
  let friendships: any[] = []
  let conversations: any[] = []

  if (db) {
    try {
      await ensureD1Database(db)
      if (conversationId) {
        let reverseConvId = conversationId
        if (conversationId.startsWith('conv_')) {
          const adminUser = memoryStore.users.get('usr_admin')
          const adminHandle = adminUser?.handle || 'admin'
          reverseConvId = 'conv_' + adminHandle
        }
        const msgRows: any = await db.prepare(
          'SELECT * FROM messages WHERE (conversation_id = ? OR conversation_id = ?) AND created_at > ? ORDER BY created_at ASC LIMIT 50'
        ).bind(conversationId, reverseConvId, since).all()
        if (msgRows?.results) {
          const seen = new Set<string>()
          newMessages = []
          for (const r of msgRows.results) {
            if (!seen.has(r.id)) {
              seen.add(r.id)
              newMessages.push({
                id: r.id,
                conversationId: r.conversation_id,
                senderId: r.sender_id,
                body: r.content,
                createdAt: new Date(r.created_at).toISOString(),
                readAt: r.read_at ? new Date(r.read_at).toISOString() : null,
              })
            }
          }
        }
      }

      const fRows: any = await db.prepare('SELECT * FROM federation_friendships ORDER BY created_at DESC LIMIT 50').all()
      if (fRows?.results) friendships = fRows.results

      const cRows: any = await db.prepare('SELECT * FROM conversations ORDER BY last_message_at DESC LIMIT 50').all()
      if (cRows?.results) {
        conversations = cRows.results.map((row: any) => ({
          id: row.id,
          otherUser: {
            id: row.user_b,
            username: row.remote_handle || row.user_b,
            displayName: row.remote_handle ? `@${row.remote_handle}` : row.user_b,
          },
          status: row.status,
          remoteInstanceUrl: row.remote_instance_url || null,
          lastMessage: row.last_message_snippet
            ? { content: row.last_message_snippet, createdAt: row.last_message_at }
            : null,
        }))
      }

      return c.json({
        serverTime: Date.now(),
        newMessages,
        friendships,
        conversations,
      })
    } catch (e: any) {
      console.warn('[Sync D1 Warning]', e?.message)
    }
  }

  // In-memory fallback
  const memMsgs = memoryStore.messages
    .filter((m) => (!conversationId || m.conversation_id === conversationId) && m.created_at > since)
    .map((m) => ({
      id: m.id,
      conversationId: m.conversation_id,
      senderId: m.sender_id,
      body: m.content,
      createdAt: new Date(m.created_at).toISOString(),
      readAt: m.read_at ? new Date(m.read_at).toISOString() : null,
    }))

  const memFriendships = Array.from(memoryStore.friendships.values()).sort((a, b) => b.created_at - a.created_at)
  const memConvs = Array.from(memoryStore.conversations.values())
    .sort((a, b) => b.last_message_at - a.last_message_at)
    .map((conv) => ({
      id: conv.id,
      otherUser: {
        id: conv.user_b,
        username: conv.remote_handle || conv.user_b,
        displayName: conv.remote_handle ? `@${conv.remote_handle}` : conv.user_b,
      },
      status: conv.status,
      remoteInstanceUrl: conv.remote_instance_url || null,
      lastMessage: conv.last_message_snippet
        ? { content: conv.last_message_snippet, createdAt: conv.last_message_at }
        : null,
    }))

  return c.json({
    serverTime: Date.now(),
    newMessages: memMsgs,
    friendships: memFriendships,
    conversations: memConvs,
  })
})

export default conversationRoutes
