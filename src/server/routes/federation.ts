import { Hono } from 'hono'
import { ensureD1Database, normalizeUrl } from '../db'
import { ensureServerKeyPair, signPayload, getExportedPublicKeyBase64 } from '../crypto'
import { memoryStore, emitUserEvent, broadcastAllStreams } from '../store'
import { extractRootDomain } from '../domain'
import type { Bindings, MemFriendship, MemConversation } from '../types'

const federationRoutes = new Hono<{ Bindings: Bindings }>()

// Friendships list (Pending incoming, pending outgoing, active)
federationRoutes.get('/api/federation/friendships', async (c) => {
  const db = c.env?.DB

  if (db) {
    try {
      await ensureD1Database(db)
      const rows: any = await db.prepare('SELECT * FROM federation_friendships ORDER BY created_at DESC').all()
      if (rows?.results) {
        return c.json({ friendships: rows.results })
      }
    } catch (d1Err: any) {
      console.warn('[D1 Friendships Warning]', d1Err?.message)
    }
  }

  const list = Array.from(memoryStore.friendships.values()).sort((a, b) => b.created_at - a.created_at)
  return c.json({ friendships: list })
})

// Send Friend Request (Outbound to Remote Peer Subdomain / Domain)
federationRoutes.post('/api/federation/requests', async (c) => {
  try {
    const body = await c.req.json()
    const { remoteHandle, remoteInstanceUrl, senderId, myHandle, myDisplayName, myInstanceUrl, pin } = body
    const cleanRemoteHandle = (remoteHandle || '').replace(/^@/, '').trim().toLowerCase()
    const normalizedUrl = normalizeUrl(remoteInstanceUrl)
    const localUserId = senderId || 'usr_admin'

    const friendshipId = 'freq_' + Math.random().toString(36).slice(2, 9)
    const conversationId = 'conv_' + cleanRemoteHandle
    const now = Date.now()

    let actualHandle = myHandle || ''
    let actualDisplayName = myDisplayName || ''
    const db = c.env?.DB

    if (db && (!actualHandle || !actualDisplayName)) {
      try {
        await ensureD1Database(db)
        const adminRow: any = await db.prepare("SELECT handle, display_name FROM users WHERE role = 'admin' LIMIT 1").first()
        if (adminRow) {
          actualHandle = actualHandle || adminRow.handle
          actualDisplayName = actualDisplayName || adminRow.display_name
        }
      } catch (e) {}
    }
    actualHandle = actualHandle || memoryStore.users.get(localUserId)?.handle || 'user'
    actualDisplayName = actualDisplayName || memoryStore.config.get('display_name') || 'Chatze User'

    const originUrl = myInstanceUrl || c.req.url.replace(/\/api\/.*$/, '')

    const friendshipRecord: MemFriendship = {
      id: friendshipId,
      local_user_id: localUserId,
      remote_handle: cleanRemoteHandle,
      remote_instance_url: normalizedUrl,
      status: 'pending',
      direction: 'outgoing',
      created_at: now,
    }

    const convRecord: MemConversation = {
      id: conversationId,
      user_a: localUserId,
      user_b: cleanRemoteHandle,
      remote_handle: cleanRemoteHandle,
      remote_instance_url: normalizedUrl,
      last_message_snippet: `Friend request sent to @${cleanRemoteHandle}`,
      last_message_at: now,
      status: 'pending',
    }

    memoryStore.friendships.set(friendshipId, friendshipRecord)
    memoryStore.conversations.set(conversationId, convRecord)

    if (db) {
      try {
        await ensureD1Database(db)
        await db.prepare('INSERT OR REPLACE INTO federation_friendships (id, local_user_id, remote_handle, remote_instance_url, status, direction, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(friendshipRecord.id, friendshipRecord.local_user_id, friendshipRecord.remote_handle, friendshipRecord.remote_instance_url, friendshipRecord.status, friendshipRecord.direction, now).run()

        await db.prepare('INSERT OR REPLACE INTO conversations (id, user_a, user_b, remote_handle, remote_instance_url, last_message_snippet, last_message_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(convRecord.id, convRecord.user_a, convRecord.user_b, convRecord.remote_handle, convRecord.remote_instance_url, convRecord.last_message_snippet, now, convRecord.status).run()
      } catch (d1Err: any) {
        console.warn('[D1 Outbound Request Warning]', d1Err?.message)
      }
    }

    const payload = JSON.stringify({
      from_handle: actualHandle,
      from_display_name: actualDisplayName,
      from_instance_url: originUrl,
      to_handle: cleanRemoteHandle,
      timestamp: now,
      pin: pin ? pin.trim() : undefined,
    })

    let signature = ''
    try {
      signature = await signPayload(payload)
    } catch (e) {
      console.warn('[Sign Error]', e)
    }

    let remoteSuccess = false
    try {
      const remoteRes = await fetch(`${normalizedUrl}/api/federation/v1/requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Federation-Signature': signature,
        },
        body: payload,
      })
      remoteSuccess = remoteRes.ok
    } catch (remoteErr: any) {
      console.warn('[Remote Peer Request Offline/Failed]', remoteErr?.message)
    }

    emitUserEvent(localUserId, 'conversation_updated', convRecord)

    return c.json({
      success: true,
      remoteDelivered: remoteSuccess,
      friendship: friendshipRecord,
      conversation: convRecord,
    })
  } catch (err: any) {
    return c.json({ error: err.message || 'Request failed' }, 400)
  }
})

// Inbound Friend Request from remote peer (Protected with Anti-Spam & Quota Guards)
federationRoutes.post('/api/federation/v1/requests', async (c) => {
  try {
    const body = await c.req.json()
    const { from_handle, from_display_name, from_instance_url, pin } = body
    const cleanFromHandle = (from_handle || 'peer').replace(/^@/, '').trim().toLowerCase()
    const remoteUrl = normalizeUrl(from_instance_url || '')
    const now = Date.now()
    const db = c.env?.DB

    if (db) {
      await ensureD1Database(db)
    }

    const rootDomain = extractRootDomain(remoteUrl)

    // Security Check 1: Blocked Domain check (Root Domain Wildcard)
    let isBlocked = memoryStore.blockedDomains.has(rootDomain)
    if (db && !isBlocked) {
      try {
        const bRow: any = await db.prepare("SELECT root_domain FROM blocked_domains WHERE root_domain = ? LIMIT 1").bind(rootDomain).first()
        if (bRow) isBlocked = true
      } catch {}
    }
    if (isBlocked) {
      return c.json({ error: `Origin root domain '${rootDomain}' is blocked by this instance.` }, 403)
    }

    // Security Check 2: Privacy Mode & Friend PIN check
    let privacyMode = memoryStore.config.get('privacy_mode') || 'pin_only'
    let configuredPin = memoryStore.config.get('friend_pin') || ''
    if (db) {
      try {
        const pModeRow: any = await db.prepare("SELECT value FROM system_config WHERE key = 'privacy_mode'").first()
        if (pModeRow?.value) privacyMode = pModeRow.value
        const pinRow: any = await db.prepare("SELECT value FROM system_config WHERE key = 'friend_pin'").first()
        if (pinRow?.value) configuredPin = pinRow.value
      } catch {}
    }

    if (privacyMode === 'closed') {
      return c.json({ error: 'This user has closed incoming friend requests (Incognito Mode).' }, 403)
    }

    if (privacyMode === 'pin_only') {
      const providedPin = (pin || '').trim()
      if (!configuredPin) {
        configuredPin = 'NP-7429'
      }
      if (!providedPin || providedPin.toUpperCase() !== configuredPin.toUpperCase()) {
        return c.json({
          error: 'Invalid or missing Friend PIN. This account requires a valid PIN or QR code handshake.',
          code: 'PIN_REQUIRED',
        }, 403)
      }
    }

    // Security Check 3: Max 5 Pending Requests Queue Ceiling
    let pendingCount = 0
    if (db) {
      try {
        const countRow: any = await db.prepare("SELECT COUNT(*) as count FROM federation_friendships WHERE direction = 'incoming' AND status = 'pending'").first()
        if (countRow?.count !== undefined) pendingCount = countRow.count
      } catch {}
    } else {
      pendingCount = Array.from(memoryStore.friendships.values()).filter(f => f.direction === 'incoming' && f.status === 'pending').length
    }

    if (pendingCount >= 5) {
      return c.json({
        error: 'Recipient has reached the maximum pending friend requests limit (5 max). Please try again later.',
        code: 'QUEUE_FULL',
      }, 429)
    }

    // Security Check 4: Root Domain & Handle Wildcard Deduplication
    let alreadyPending = false
    for (const [, f] of memoryStore.friendships) {
      if ((f.remote_handle === cleanFromHandle || extractRootDomain(f.remote_instance_url) === rootDomain) && f.status === 'pending') {
        alreadyPending = true
        break
      }
    }
    if (db && !alreadyPending) {
      try {
        const existing: any = await db.prepare("SELECT id FROM federation_friendships WHERE (remote_handle = ? OR remote_instance_url LIKE ?) AND status = 'pending' LIMIT 1")
          .bind(cleanFromHandle, `%${rootDomain}%`).first()
        if (existing) alreadyPending = true
      } catch {}
    }

    if (alreadyPending) {
      return c.json({ success: true, status: 'already_pending' }, 200)
    }

    const friendshipId = 'freq_in_' + Math.random().toString(36).slice(2, 9)
    const conversationId = 'conv_' + cleanFromHandle

    const incomingFriendship: MemFriendship = {
      id: friendshipId,
      local_user_id: 'usr_admin',
      remote_handle: cleanFromHandle,
      remote_instance_url: remoteUrl,
      status: 'pending',
      direction: 'incoming',
      created_at: now,
    }

    const incomingConv: MemConversation = {
      id: conversationId,
      user_a: 'usr_admin',
      user_b: cleanFromHandle,
      remote_handle: cleanFromHandle,
      remote_instance_url: remoteUrl,
      last_message_snippet: `Connection request from @${cleanFromHandle}`,
      last_message_at: now,
      status: 'pending',
    }

    memoryStore.friendships.set(friendshipId, incomingFriendship)
    memoryStore.conversations.set(conversationId, incomingConv)

    if (db) {
      try {
        await db.prepare('INSERT OR REPLACE INTO federation_friendships (id, local_user_id, remote_handle, remote_instance_url, status, direction, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(incomingFriendship.id, incomingFriendship.local_user_id, incomingFriendship.remote_handle, incomingFriendship.remote_instance_url, incomingFriendship.status, incomingFriendship.direction, now).run()

        await db.prepare('INSERT OR REPLACE INTO conversations (id, user_a, user_b, remote_handle, remote_instance_url, last_message_snippet, last_message_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(incomingConv.id, incomingConv.user_a, incomingConv.user_b, incomingConv.remote_handle, incomingConv.remote_instance_url, incomingConv.last_message_snippet, now, incomingConv.status).run()
      } catch (d1Err: any) {
        console.warn('[D1 Inbound Request Warning]', d1Err?.message)
      }
    }

    await broadcastAllStreams('incoming_friend_request', {
      friendship: incomingFriendship,
      from_handle: cleanFromHandle,
      from_display_name: from_display_name || `@${cleanFromHandle}`,
      from_instance_url: remoteUrl,
    }, c.env)

    return c.json({ success: true, status: 'received' }, 201)
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

// Friend Request Accept & Dual-Sided 0ms Live Unlock
federationRoutes.post('/api/federation/requests/accept', async (c) => {
  try {
    const { remoteHandle, remoteInstanceUrl, myHandle } = await c.req.json()
    const cleanHandle = (remoteHandle || '').replace(/^@/, '').trim().toLowerCase()
    const conversationId = 'conv_' + cleanHandle
    const now = Date.now()

    for (const [, f] of memoryStore.friendships) {
      if (f.remote_handle === cleanHandle) f.status = 'active'
    }
    const conv = memoryStore.conversations.get(conversationId)
    if (conv) {
      conv.status = 'active'
      conv.last_message_snippet = 'Connected! You can now message each other.'
    }

    const db = c.env?.DB
    let actualMyHandle = myHandle || ''
    if (db) {
      try {
        await ensureD1Database(db)
        await db.prepare("UPDATE federation_friendships SET status = 'active', created_at = ? WHERE remote_handle = ?").bind(now, cleanHandle).run()
        await db.prepare("UPDATE conversations SET status = 'active', last_message_snippet = 'Connected! You can now message each other.', last_message_at = ? WHERE id = ?").bind(now, conversationId).run()
        if (!actualMyHandle) {
          const adminRow: any = await db.prepare("SELECT handle FROM users WHERE role = 'admin' LIMIT 1").first()
          if (adminRow) actualMyHandle = adminRow.handle
        }
      } catch (d1Err: any) {
        console.warn('[D1 Accept Warning]', d1Err?.message)
      }
    }
    actualMyHandle = actualMyHandle || 'me'

    await broadcastAllStreams('friend_accepted', {
      remoteHandle: cleanHandle,
      conversationId,
      status: 'active',
    }, c.env)

    if (remoteInstanceUrl) {
      try {
        await fetch(`${normalizeUrl(remoteInstanceUrl)}/api/federation/v1/requests/accept`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from_handle: actualMyHandle,
            accepted: true,
            timestamp: now,
          }),
        })
      } catch (err: any) {
        console.warn('[Accept Dispatch Warning]', err?.message)
      }
    }

    return c.json({ success: true, unlocked: true })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

// Peer approved our request
federationRoutes.post('/api/federation/v1/requests/accept', async (c) => {
  try {
    const { from_handle } = await c.req.json()
    const cleanHandle = (from_handle || '').replace(/^@/, '').trim().toLowerCase()
    const conversationId = 'conv_' + cleanHandle

    for (const [, f] of memoryStore.friendships) {
      if (f.remote_handle === cleanHandle) f.status = 'active'
    }
    const conv = memoryStore.conversations.get(conversationId)
    if (conv) {
      conv.status = 'active'
      conv.last_message_snippet = 'Connected! You can now message each other.'
    }

    const db = c.env?.DB
    const now = Date.now()
    if (db) {
      try {
        await ensureD1Database(db)
        await db.prepare("UPDATE federation_friendships SET status = 'active', created_at = ? WHERE remote_handle = ?").bind(now, cleanHandle).run()
        await db.prepare("UPDATE conversations SET status = 'active', last_message_snippet = 'Connected! You can now message each other.', last_message_at = ? WHERE id = ?").bind(now, conversationId).run()
      } catch (d1Err: any) {
        console.warn('[D1 Remote Accept Warning]', d1Err?.message)
      }
    }

    await broadcastAllStreams('friend_accepted', {
      remoteHandle: cleanHandle,
      conversationId,
      status: 'active',
    }, c.env)

    return c.json({ success: true, status: 'unlocked' })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

// Reject / Decline Friend Request (With optional Root Domain Blacklist)
federationRoutes.post('/api/federation/requests/reject', async (c) => {
  try {
    const { remoteHandle, blockDomain, remoteInstanceUrl } = await c.req.json()
    const cleanHandle = (remoteHandle || '').replace(/^@/, '').trim().toLowerCase()
    const db = c.env?.DB

    let foundUrl = remoteInstanceUrl || ''
    for (const [id, f] of memoryStore.friendships) {
      if (f.remote_handle === cleanHandle) {
        if (!foundUrl) foundUrl = f.remote_instance_url
        memoryStore.friendships.delete(id)
      }
    }
    memoryStore.conversations.delete('conv_' + cleanHandle)

    if (db) {
      try {
        await ensureD1Database(db)
        if (!foundUrl) {
          const row: any = await db.prepare("SELECT remote_instance_url FROM federation_friendships WHERE remote_handle = ? LIMIT 1").bind(cleanHandle).first()
          if (row) foundUrl = row.remote_instance_url
        }
        await db.prepare("DELETE FROM federation_friendships WHERE remote_handle = ?").bind(cleanHandle).run()
        await db.prepare("DELETE FROM conversations WHERE id = ?").bind('conv_' + cleanHandle).run()
      } catch (d1Err: any) {
        console.warn('[D1 Reject Warning]', d1Err?.message)
      }
    }

    // If blockDomain requested, blacklist the root domain
    if (blockDomain && foundUrl) {
      const rootDomain = extractRootDomain(foundUrl)
      const now = Date.now()
      memoryStore.blockedDomains.set(rootDomain, { root_domain: rootDomain, reason: `Blocked user @${cleanHandle}`, blocked_at: now })
      if (db) {
        try {
          await db.prepare("INSERT OR REPLACE INTO blocked_domains (root_domain, reason, blocked_at) VALUES (?, ?, ?)")
            .bind(rootDomain, `Blocked user @${cleanHandle}`, now).run()
        } catch {}
      }
    }

    await broadcastAllStreams('friendship_removed', { remoteHandle: cleanHandle }, c.env)
    return c.json({ success: true, blockedDomain: blockDomain ? true : false })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

// Block Domain endpoint
federationRoutes.post('/api/federation/domains/block', async (c) => {
  try {
    const { rootDomain, reason } = await c.req.json()
    if (!rootDomain) return c.json({ error: 'Root domain required' }, 400)
    const cleanDomain = extractRootDomain(rootDomain)
    const now = Date.now()

    memoryStore.blockedDomains.set(cleanDomain, { root_domain: cleanDomain, reason: reason || 'Manual block', blocked_at: now })

    const db = c.env?.DB
    if (db) {
      try {
        await ensureD1Database(db)
        await db.prepare("INSERT OR REPLACE INTO blocked_domains (root_domain, reason, blocked_at) VALUES (?, ?, ?)")
          .bind(cleanDomain, reason || 'Manual block', now).run()
      } catch {}
    }

    return c.json({ success: true, blockedDomain: cleanDomain })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

// Unblock Domain endpoint
federationRoutes.post('/api/federation/domains/unblock', async (c) => {
  try {
    const { rootDomain } = await c.req.json()
    if (!rootDomain) return c.json({ error: 'Root domain required' }, 400)
    const cleanDomain = extractRootDomain(rootDomain)

    memoryStore.blockedDomains.delete(cleanDomain)

    const db = c.env?.DB
    if (db) {
      try {
        await ensureD1Database(db)
        await db.prepare("DELETE FROM blocked_domains WHERE root_domain = ?").bind(cleanDomain).run()
      } catch {}
    }

    return c.json({ success: true, unblockedDomain: cleanDomain })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

// List Blocked Domains
federationRoutes.get('/api/federation/domains/blocked', async (c) => {
  const db = c.env?.DB
  let list: any[] = []

  if (db) {
    try {
      await ensureD1Database(db)
      const { results } = await db.prepare("SELECT * FROM blocked_domains ORDER BY blocked_at DESC").all()
      if (Array.isArray(results)) list = results
    } catch {}
  }

  if (list.length === 0) {
    list = Array.from(memoryStore.blockedDomains.values())
  }

  return c.json({ blockedDomains: list })
})

// Identity & Federation info
federationRoutes.get('/api/federation/identity', async (c) => {
  await ensureServerKeyPair(c.env?.DB)
  const myHandle = memoryStore.users.get('usr_admin')?.handle || 'admin'
  return c.json({
    version: '1.0.0',
    instance_url: c.req.url.replace(/\/api\/.*$/, ''),
    handle: myHandle,
    name: memoryStore.config.get('display_name') || 'Chatze User',
    public_key: getExportedPublicKeyBase64(),
    algorithm: 'ECDSA-P256-SHA256',
    created_at: Date.now(),
  })
})

export default federationRoutes
