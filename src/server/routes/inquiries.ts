import { Hono } from 'hono'
import { ensureD1Database } from '../db'
import { memoryStore, broadcastAllStreams } from '../store'
import { extractRootDomain } from '../domain'
import { sendPushNotification } from '../webpush'
import type { Bindings, MemInquiry, MemConversation, MemMessage } from '../types'

const inquiryRoutes = new Hono<{ Bindings: Bindings }>()

// ============================================================================
// The Static Letterbox: 1-Card Customer Inquiry Drop API
// ============================================================================

// Customer drops 1 note into the shop's Letterbox (Zero-Flood Guarantee)
inquiryRoutes.post('/api/inquiries', async (c) => {
  try {
    const body = await c.req.json()
    const { shopHandle, senderName, senderHandle, senderOriginUrl, content } = body

    const cleanContent = (content || '').trim()
    if (!cleanContent) {
      return c.json({ error: 'Inquiry note content cannot be empty' }, 400)
    }

    if (cleanContent.length > 500) {
      return c.json({ error: 'Inquiry note cannot exceed 500 characters' }, 400)
    }

    const cleanSenderName = (senderName || 'Nepali Shopper').trim()
    const cleanSenderHandle = (senderHandle || 'guest_' + Math.random().toString(36).slice(2, 7))
      .replace(/^@/, '')
      .trim()
      .toLowerCase()

    const origin = senderOriginUrl || c.req.header('origin') || c.req.header('referer') || 'direct-client'
    const rootDomain = extractRootDomain(origin)
    const db = c.env?.DB
    const now = Date.now()

    if (db) {
      await ensureD1Database(db)
    }

    // 1. Check if root domain is blacklisted
    let isBlocked = memoryStore.blockedDomains.has(rootDomain)
    if (db && !isBlocked) {
      try {
        const bRow: any = await db.prepare("SELECT root_domain FROM blocked_domains WHERE root_domain = ? LIMIT 1").bind(rootDomain).first()
        if (bRow) isBlocked = true
      } catch {}
    }
    if (isBlocked) {
      return c.json({ error: 'Submissions from your origin domain are blocked by this shop.' }, 403)
    }

    // 2. Check if shop is in business mode and letterbox is enabled
    let letterboxEnabled = memoryStore.config.get('inquiry_letterbox_enabled') !== 'false'
    let accountType = memoryStore.config.get('account_type') || 'personal'
    if (db) {
      try {
        const lRow: any = await db.prepare("SELECT value FROM system_config WHERE key = 'inquiry_letterbox_enabled'").first()
        if (lRow) letterboxEnabled = lRow.value === 'true'
        const aRow: any = await db.prepare("SELECT value FROM system_config WHERE key = 'account_type'").first()
        if (aRow) accountType = aRow.value
      } catch {}
    }

    if (accountType !== 'business') {
      return c.json({ error: 'This account is currently in Personal mode. Customer inquiries are reserved for Business accounts.' }, 403)
    }

    if (!letterboxEnabled) {
      return c.json({ error: 'The shop owner has temporarily closed customer inquiries.' }, 403)
    }

    // 3. The 1-Card Gate (Strict Deduplication per Root Domain / Handle)
    let alreadyHasPending = false
    for (const [, inq] of memoryStore.inquiries) {
      if ((inq.sender_root_domain === rootDomain || inq.sender_handle === cleanSenderHandle) && inq.status === 'pending') {
        alreadyHasPending = true
        break
      }
    }
    if (db && !alreadyHasPending) {
      try {
        const existingRow: any = await db.prepare(
          "SELECT id FROM static_inquiries WHERE (sender_root_domain = ? OR sender_handle = ?) AND status = 'pending' LIMIT 1"
        ).bind(rootDomain, cleanSenderHandle).first()
        if (existingRow) alreadyHasPending = true
      } catch {}
    }

    if (alreadyHasPending) {
      return c.json({
        error: 'You have already dropped a note for this shop. Please wait for the owner to reply before sending another.',
        code: 'CARD_ALREADY_PENDING',
      }, 429)
    }

    // 4. Queue Capacity Check (Max 20 pending inquiries per shop)
    let pendingCount = 0
    if (db) {
      try {
        const countRow: any = await db.prepare("SELECT COUNT(*) as count FROM static_inquiries WHERE status = 'pending'").first()
        if (countRow?.count !== undefined) pendingCount = countRow.count
      } catch {}
    } else {
      pendingCount = Array.from(memoryStore.inquiries.values()).filter(i => i.status === 'pending').length
    }

    if (pendingCount >= 20) {
      return c.json({
        error: "The shop's inquiry letterbox is currently full (20 notes max). Please try again shortly.",
        code: 'LETTERBOX_FULL',
      }, 429)
    }

    // 5. Store the 1-Card Note
    const inquiryId = 'inq_' + Math.random().toString(36).slice(2, 9)
    const inquiryRecord: MemInquiry = {
      id: inquiryId,
      sender_handle: cleanSenderHandle,
      sender_name: cleanSenderName,
      sender_root_domain: rootDomain,
      sender_origin_url: origin,
      content: cleanContent,
      status: 'pending',
      created_at: now,
    }

    memoryStore.inquiries.set(inquiryId, inquiryRecord)

    if (db) {
      try {
        await db.prepare(
          'INSERT INTO static_inquiries (id, sender_handle, sender_name, sender_root_domain, sender_origin_url, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?, "pending", ?)'
        ).bind(inquiryId, cleanSenderHandle, cleanSenderName, rootDomain, origin, cleanContent, now).run()
      } catch (d1Err: any) {
        console.warn('[D1 Inquiry Insert Warning]', d1Err?.message)
      }
    }

    // 6. Broadcast event & Push notification to shop owner
    await broadcastAllStreams('new_customer_inquiry', inquiryRecord, c.env)

    try {
      await sendPushNotification(c.env, null, {
        title: `📩 Customer Note: ${cleanSenderName}`,
        body: cleanContent,
        conversationId: 'inquiries',
        url: '/?tab=inquiries',
      })
    } catch {}

    return c.json({
      success: true,
      inquiryId,
      message: 'Your inquiry note has been safely placed in the shop letterbox!',
    }, 201)
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to submit inquiry' }, 400)
  }
})

// Shop owner gets inquiries list
inquiryRoutes.get('/api/inquiries', async (c) => {
  const db = c.env?.DB
  let list: any[] = []

  if (db) {
    try {
      await ensureD1Database(db)
      const { results } = await db.prepare('SELECT * FROM static_inquiries ORDER BY created_at DESC LIMIT 50').all()
      if (Array.isArray(results)) list = results
    } catch (e: any) {
      console.warn('[D1 Inquiries Fetch Warning]', e?.message)
    }
  }

  if (list.length === 0) {
    list = Array.from(memoryStore.inquiries.values()).sort((a, b) => b.created_at - a.created_at)
  }

  const pendingCount = list.filter((i) => i.status === 'pending').length

  return c.json({
    inquiries: list,
    pendingCount,
  })
})

// Shop owner replies / accepts inquiry (Unlocks full 2-way chat)
inquiryRoutes.post('/api/inquiries/reply', async (c) => {
  try {
    const { inquiryId } = await c.req.json()
    if (!inquiryId) return c.json({ error: 'Inquiry ID required' }, 400)

    const db = c.env?.DB
    const now = Date.now()

    let inquiry = memoryStore.inquiries.get(inquiryId)
    if (!inquiry && db) {
      try {
        await ensureD1Database(db)
        const row: any = await db.prepare('SELECT * FROM static_inquiries WHERE id = ? LIMIT 1').bind(inquiryId).first()
        if (row) inquiry = row
      } catch {}
    }

    if (!inquiry) {
      return c.json({ error: 'Inquiry note not found' }, 404)
    }

    // Mark inquiry accepted
    if (inquiry) inquiry.status = 'accepted'
    const conversationId = 'conv_' + inquiry.sender_handle
    const messageId = 'msg_' + Math.random().toString(36).slice(2, 9)

    // Create active conversation
    const convRecord: MemConversation = {
      id: conversationId,
      user_a: 'usr_admin',
      user_b: inquiry.sender_handle,
      remote_handle: inquiry.sender_handle,
      remote_instance_url: inquiry.sender_origin_url,
      last_message_snippet: inquiry.content,
      last_message_at: now,
      status: 'active',
    }
    memoryStore.conversations.set(conversationId, convRecord)

    // Store inquiry message as first message
    const msgRecord: MemMessage = {
      id: messageId,
      conversation_id: conversationId,
      sender_id: inquiry.sender_handle,
      content: inquiry.content,
      created_at: now,
      read_at: now,
    }
    memoryStore.messages.push(msgRecord)

    if (db) {
      try {
        await db.prepare("UPDATE static_inquiries SET status = 'accepted' WHERE id = ?").bind(inquiryId).run()
        await db.prepare('INSERT OR REPLACE INTO conversations (id, user_a, user_b, remote_handle, remote_instance_url, last_message_snippet, last_message_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, "active")')
          .bind(convRecord.id, convRecord.user_a, convRecord.user_b, convRecord.remote_handle, convRecord.remote_instance_url, convRecord.last_message_snippet, now).run()
        await db.prepare('INSERT OR REPLACE INTO messages (id, conversation_id, sender_id, content, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(msgRecord.id, msgRecord.conversation_id, msgRecord.sender_id, msgRecord.content, now, now).run()
      } catch (d1Err: any) {
        console.warn('[D1 Reply Convert Warning]', d1Err?.message)
      }
    }

    await broadcastAllStreams('conversation_updated', convRecord, c.env)
    await broadcastAllStreams('inquiry_status_updated', { inquiryId, status: 'accepted' }, c.env)

    return c.json({
      success: true,
      conversationId,
      message: 'Inquiry accepted! Conversation unlocked.',
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

// Shop owner dismisses inquiry (Optionally blacklists root domain)
inquiryRoutes.post('/api/inquiries/dismiss', async (c) => {
  try {
    const { inquiryId, blockDomain } = await c.req.json()
    if (!inquiryId) return c.json({ error: 'Inquiry ID required' }, 400)

    const db = c.env?.DB
    const now = Date.now()

    let inquiry = memoryStore.inquiries.get(inquiryId)
    if (!inquiry && db) {
      try {
        await ensureD1Database(db)
        const row: any = await db.prepare('SELECT * FROM static_inquiries WHERE id = ? LIMIT 1').bind(inquiryId).first()
        if (row) inquiry = row
      } catch {}
    }

    if (inquiry) inquiry.status = 'dismissed'

    if (db) {
      try {
        await ensureD1Database(db)
        await db.prepare("UPDATE static_inquiries SET status = 'dismissed' WHERE id = ?").bind(inquiryId).run()
      } catch {}
    }

    if (blockDomain && inquiry?.sender_root_domain) {
      const rootDomain = inquiry.sender_root_domain
      memoryStore.blockedDomains.set(rootDomain, { root_domain: rootDomain, reason: `Blocked after dismissing inquiry`, blocked_at: now })
      if (db) {
        try {
          await db.prepare("INSERT OR REPLACE INTO blocked_domains (root_domain, reason, blocked_at) VALUES (?, ?, ?)")
            .bind(rootDomain, `Blocked after dismissing inquiry`, now).run()
        } catch {}
      }
    }

    await broadcastAllStreams('inquiry_status_updated', { inquiryId, status: 'dismissed' }, c.env)

    return c.json({ success: true, dismissed: true, domainBlocked: Boolean(blockDomain) })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

export default inquiryRoutes
