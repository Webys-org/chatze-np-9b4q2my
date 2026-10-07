import { Hono } from 'hono'
import { ensureD1Database } from '../db'
import { memoryStore } from '../store'
import type { Bindings } from '../types'

const profileRoutes = new Hono<{ Bindings: Bindings }>()

function generatePin(): string {
  const digits = Math.floor(1000 + Math.random() * 9000).toString()
  return `NP-${digits}`
}

// GET Current Profile & Privacy Settings
profileRoutes.get('/api/profile', async (c) => {
  const db = c.env?.DB
  let adminHandle = 'admin'
  let adminDisplayName = 'Chatze User'

  const user = memoryStore.users.get('usr_admin')
  if (user) {
    adminHandle = user.handle
    adminDisplayName = user.display_name
  }

  const profile = {
    displayName: memoryStore.config.get('display_name') || adminDisplayName,
    handle: adminHandle,
    accountType: (memoryStore.config.get('account_type') as 'personal' | 'business') || 'personal',
    bio: memoryStore.config.get('bio') || '',
    businessCategory: memoryStore.config.get('business_category') || 'General',
    privacyMode: (memoryStore.config.get('privacy_mode') as 'open' | 'pin_only' | 'closed') || 'pin_only',
    friendPin: memoryStore.config.get('friend_pin') || '',
    inquiryLetterboxEnabled: memoryStore.config.get('inquiry_letterbox_enabled') !== 'false',
    instanceUrl: c.req.url.replace(/\/api\/.*$/, ''),
  }

  if (db) {
    try {
      await ensureD1Database(db)
      const { results } = await db.prepare(
        "SELECT key, value FROM system_config WHERE key IN ('display_name', 'account_type', 'bio', 'business_category', 'privacy_mode', 'friend_pin', 'inquiry_letterbox_enabled')"
      ).all()

      if (Array.isArray(results)) {
        for (const row of results as any[]) {
          if (row.key === 'display_name') profile.displayName = row.value
          if (row.key === 'account_type') profile.accountType = row.value
          if (row.key === 'bio') profile.bio = row.value
          if (row.key === 'business_category') profile.businessCategory = row.value
          if (row.key === 'privacy_mode') profile.privacyMode = row.value
          if (row.key === 'friend_pin') profile.friendPin = row.value
          if (row.key === 'inquiry_letterbox_enabled') profile.inquiryLetterboxEnabled = row.value === 'true'
        }
      }

      const adminRow: any = await db.prepare("SELECT handle, display_name FROM users WHERE role = 'admin' LIMIT 1").first()
      if (adminRow) {
        profile.handle = adminRow.handle
        if (!profile.displayName) profile.displayName = adminRow.display_name
      }
    } catch (e: any) {
      console.warn('[D1 Profile Read Warning]', e?.message)
    }
  }

  // Ensure default PIN exists
  if (!profile.friendPin) {
    profile.friendPin = generatePin()
    memoryStore.config.set('friend_pin', profile.friendPin)
    if (db) {
      try {
        await db.prepare("INSERT OR REPLACE INTO system_config (key, value) VALUES ('friend_pin', ?)").bind(profile.friendPin).run()
      } catch {}
    }
  }

  return c.json({ profile })
})

// POST Update Profile & Privacy Settings
profileRoutes.post('/api/profile', async (c) => {
  try {
    const body = await c.req.json()
    const {
      displayName,
      accountType,
      bio,
      businessCategory,
      privacyMode,
      friendPin,
      inquiryLetterboxEnabled,
    } = body

    const cleanName = (displayName || '').trim() || 'Chatze User'
    const cleanAccountType = accountType === 'business' ? 'business' : 'personal'
    const cleanBio = (bio || '').trim()
    const cleanCategory = (businessCategory || 'General').trim()
    const cleanPrivacy = ['open', 'pin_only', 'closed'].includes(privacyMode) ? privacyMode : 'pin_only'
    const cleanPin = (friendPin || '').trim() || generatePin()
    const cleanLetterbox = inquiryLetterboxEnabled !== false ? 'true' : 'false'

    // Update memory store
    memoryStore.config.set('display_name', cleanName)
    memoryStore.config.set('account_type', cleanAccountType)
    memoryStore.config.set('bio', cleanBio)
    memoryStore.config.set('business_category', cleanCategory)
    memoryStore.config.set('privacy_mode', cleanPrivacy)
    memoryStore.config.set('friend_pin', cleanPin)
    memoryStore.config.set('inquiry_letterbox_enabled', cleanLetterbox)

    const admin = memoryStore.users.get('usr_admin')
    if (admin) {
      admin.display_name = cleanName
    }

    const db = c.env?.DB
    if (db) {
      try {
        await ensureD1Database(db)
        await db.batch([
          db.prepare("INSERT OR REPLACE INTO system_config (key, value) VALUES ('display_name', ?)").bind(cleanName),
          db.prepare("INSERT OR REPLACE INTO system_config (key, value) VALUES ('account_type', ?)").bind(cleanAccountType),
          db.prepare("INSERT OR REPLACE INTO system_config (key, value) VALUES ('bio', ?)").bind(cleanBio),
          db.prepare("INSERT OR REPLACE INTO system_config (key, value) VALUES ('business_category', ?)").bind(cleanCategory),
          db.prepare("INSERT OR REPLACE INTO system_config (key, value) VALUES ('privacy_mode', ?)").bind(cleanPrivacy),
          db.prepare("INSERT OR REPLACE INTO system_config (key, value) VALUES ('friend_pin', ?)").bind(cleanPin),
          db.prepare("INSERT OR REPLACE INTO system_config (key, value) VALUES ('inquiry_letterbox_enabled', ?)").bind(cleanLetterbox),
          db.prepare("UPDATE users SET display_name = ? WHERE role = 'admin'").bind(cleanName),
        ])
      } catch (d1Err: any) {
        console.warn('[D1 Profile Save Warning]', d1Err?.message)
      }
    }

    return c.json({
      success: true,
      profile: {
        displayName: cleanName,
        accountType: cleanAccountType,
        bio: cleanBio,
        businessCategory: cleanCategory,
        privacyMode: cleanPrivacy,
        friendPin: cleanPin,
        inquiryLetterboxEnabled: cleanLetterbox === 'true',
        instanceUrl: c.req.url.replace(/\/api\/.*$/, ''),
      },
    })
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to update profile' }, 400)
  }
})

// POST Regenerate Friend PIN
profileRoutes.post('/api/profile/pin/regenerate', async (c) => {
  const newPin = generatePin()
  memoryStore.config.set('friend_pin', newPin)
  const db = c.env?.DB
  if (db) {
    try {
      await ensureD1Database(db)
      await db.prepare("INSERT OR REPLACE INTO system_config (key, value) VALUES ('friend_pin', ?)").bind(newPin).run()
    } catch {}
  }
  return c.json({ success: true, friendPin: newPin })
})

export default profileRoutes
