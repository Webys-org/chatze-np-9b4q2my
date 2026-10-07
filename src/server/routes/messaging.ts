import { Hono } from 'hono'
import { ensureD1Database, normalizeUrl } from '../db'
import { memoryStore, emitUserEvent, broadcastAllStreams } from '../store'
import { sendPushNotification } from '../webpush'
import type { Bindings } from '../types'

const messagingRoutes = new Hono<{ Bindings: Bindings }>()

// Messages: 0ms Optimistic Delivery + Cross-Peer Forwarding
messagingRoutes.get('/api/messaging', async (c) => {
  const conversationId = c.req.query('conversationId')
  if (!conversationId) return c.json({ messages: [] })
  const db = c.env?.DB

  // Bidirectional resolution: if query is conv_alice, also resolve reverse conv_bob if needed
  let reverseConvId = conversationId
  if (conversationId.startsWith('conv_')) {
    const handlePart = conversationId.replace('conv_', '')
    const adminUser = memoryStore.users.get('usr_admin')
    const adminHandle = adminUser?.handle || 'admin'
    reverseConvId = 'conv_' + adminHandle
  }

  if (db) {
    try {
      await ensureD1Database(db)
      const rows: any = await db.prepare(
        'SELECT * FROM messages WHERE conversation_id = ? OR conversation_id = ? ORDER BY created_at ASC'
      ).bind(conversationId, reverseConvId).all()
      if (rows?.results) {
        const seen = new Set<string>()
        const mapped: any[] = []
        for (const r of rows.results) {
          if (!seen.has(r.id)) {
            seen.add(r.id)
            mapped.push({
              id: r.id,
              conversationId: r.conversation_id,
              senderId: r.sender_id,
              body: r.content,
              createdAt: new Date(r.created_at).toISOString(),
              readAt: r.read_at ? new Date(r.read_at).toISOString() : null,
            })
          }
        }
        return c.json({ messages: mapped })
      }
    } catch (d1Err: any) {
      console.warn('[D1 Messages Warning]', d1Err?.message)
    }
  }

  const seen = new Set<string>()
  const msgs = memoryStore.messages
    .filter((m) => m.conversation_id === conversationId || m.conversation_id === reverseConvId)
    .sort((a, b) => a.created_at - b.created_at)
    .filter((m) => {
      if (seen.has(m.id)) return false
      seen.add(m.id)
      return true
    })
    .map((m) => ({
      id: m.id,
      conversationId: m.conversation_id,
      senderId: m.sender_id,
      body: m.content,
      createdAt: new Date(m.created_at).toISOString(),
      readAt: m.read_at ? new Date(m.read_at).toISOString() : null,
    }))

  return c.json({ messages: msgs })
})

messagingRoutes.post('/api/messaging', async (c) => {
  try {
    const { conversationId, body, senderId, tempId, remoteInstanceUrl, remoteHandle, myHandle } = await c.req.json()
    const messageId = 'msg_' + Math.random().toString(36).slice(2, 9)
    const now = Date.now()
    const actualSender = senderId || 'usr_admin'
    const cleanSenderHandle = (myHandle || '').replace(/^@/, '').trim().toLowerCase()
    const cleanRemoteHandle = (remoteHandle || '').replace(/^@/, '').trim().toLowerCase()

    const messageRecord = {
      id: messageId,
      conversationId: conversationId || 'conv_general',
      senderId: actualSender,
      senderHandle: cleanSenderHandle,
      recipientHandle: cleanRemoteHandle,
      body: body || '',
      createdAt: new Date(now).toISOString(),
      readAt: null,
      tempId: tempId || null,
    }

    memoryStore.messages.push({
      id: messageRecord.id,
      conversation_id: messageRecord.conversationId,
      sender_id: messageRecord.senderId,
      content: messageRecord.body,
      created_at: now,
      read_at: null,
    })
    const conv = memoryStore.conversations.get(messageRecord.conversationId)
    if (conv) {
      conv.last_message_snippet = messageRecord.body
      conv.last_message_at = now
    }

    const reverseConvId = cleanSenderHandle ? 'conv_' + cleanSenderHandle : null
    const reverseConv = reverseConvId ? memoryStore.conversations.get(reverseConvId) : null
    if (reverseConv) {
      reverseConv.last_message_snippet = messageRecord.body
      reverseConv.last_message_at = now
    }

    const db = c.env?.DB
    if (db) {
      try {
        await ensureD1Database(db)
        await db.prepare('INSERT INTO messages (id, conversation_id, sender_id, content, created_at, read_at) VALUES (?, ?, ?, ?, ?, NULL)')
          .bind(messageRecord.id, messageRecord.conversationId, messageRecord.senderId, messageRecord.body, now).run()
        await db.prepare('UPDATE conversations SET last_message_snippet = ?, last_message_at = ? WHERE id = ? OR (id = ? AND ? IS NOT NULL)')
          .bind(messageRecord.body, now, messageRecord.conversationId, reverseConvId, reverseConvId).run()
      } catch (d1Err: any) {
        console.warn('[D1 Message Insert Warning]', d1Err?.message)
      }
    }

    emitUserEvent(actualSender, 'new_message', messageRecord)
    await broadcastAllStreams('new_message', messageRecord, c.env)

    // Web Push background dispatch (asynchronous, 0ms latency to SSE)
    const recipientToNotify = cleanRemoteHandle || (conv?.user_a === actualSender ? conv?.user_b : conv?.user_a) || null
    const pushNotification = {
      title: `@${cleanSenderHandle || 'User'}`,
      body: messageRecord.body,
      conversationId: messageRecord.conversationId,
      url: `/?conv=${messageRecord.conversationId}`,
    }
    try {
      await sendPushNotification(c.env, recipientToNotify, pushNotification)
    } catch (e: any) {
      console.warn('[Push Notification Error]', e?.message)
    }

    const targetUrl = remoteInstanceUrl || memoryStore.conversations.get(conversationId)?.remote_instance_url
    if (targetUrl) {
      let senderHandle = myHandle || ''
      if (db && !senderHandle) {
        try {
          const adminRow: any = await db.prepare("SELECT handle FROM users WHERE role = 'admin' LIMIT 1").first()
          if (adminRow) senderHandle = adminRow.handle
        } catch (e) {}
      }
      senderHandle = senderHandle || memoryStore.users.get(actualSender)?.handle || 'me'
      const targetHandle = remoteHandle || memoryStore.conversations.get(conversationId)?.remote_handle

      try {
        await fetch(`${normalizeUrl(targetUrl)}/api/federation/v1/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sender_handle: senderHandle,
            recipient_handle: targetHandle,
            body: messageRecord.body,
            conversation_id: 'conv_' + senderHandle,
            timestamp: now,
          }),
        })
      } catch (err: any) {
        console.warn('[Remote Forward Warning]', err?.message)
      }
    }

    return c.json({ success: true, message: messageRecord }, 201)
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

// Peer sent a message to us
messagingRoutes.post('/api/federation/v1/messages', async (c) => {
  try {
    const { sender_handle, body, timestamp } = await c.req.json()
    const cleanSender = (sender_handle || 'peer').replace(/^@/, '').trim().toLowerCase()
    const conversationId = 'conv_' + cleanSender
    const messageId = 'msg_in_' + Math.random().toString(36).slice(2, 9)
    const now = timestamp || Date.now()

    const adminUser = memoryStore.users.get('usr_admin')
    const adminHandle = adminUser?.handle || 'admin'

    const messageRecord = {
      id: messageId,
      conversationId,
      senderId: cleanSender,
      senderHandle: cleanSender,
      recipientHandle: adminHandle,
      body: body || '',
      createdAt: new Date(now).toISOString(),
      readAt: null,
    }

    memoryStore.messages.push({
      id: messageRecord.id,
      conversation_id: messageRecord.conversationId,
      sender_id: messageRecord.senderId,
      content: messageRecord.body,
      created_at: now,
      read_at: null,
    })
    const conv = memoryStore.conversations.get(conversationId)
    if (conv) {
      conv.last_message_snippet = messageRecord.body
      conv.last_message_at = now
    }

    const db = c.env?.DB
    if (db) {
      try {
        await ensureD1Database(db)
        await db.prepare('INSERT INTO messages (id, conversation_id, sender_id, content, created_at, read_at) VALUES (?, ?, ?, ?, ?, NULL)')
          .bind(messageRecord.id, messageRecord.conversationId, messageRecord.senderId, messageRecord.body, now).run()
        await db.prepare('UPDATE conversations SET last_message_snippet = ?, last_message_at = ? WHERE id = ?')
          .bind(messageRecord.body, now, conversationId).run()
      } catch (d1Err: any) {
        console.warn('[D1 Peer Inbound Message Warning]', d1Err?.message)
      }
    }

    await broadcastAllStreams('new_message', messageRecord, c.env)

    // Web Push background alert for inbound peer message (asynchronous, never blocks HTTP response)
    const pushNotification = {
      title: `@${cleanSender}`,
      body: messageRecord.body,
      conversationId: messageRecord.conversationId,
      url: `/?conv=${messageRecord.conversationId}`,
    }
    try {
      await sendPushNotification(c.env, null, pushNotification)
    } catch (e: any) {
      console.warn('[Federation Inbound Push Error]', e?.message)
    }

    return c.json({ success: true, id: messageId }, 201)
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

export default messagingRoutes
