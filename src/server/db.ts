let d1Initialized = false

export const D1_INIT_STATEMENTS = [
  'CREATE TABLE IF NOT EXISTS system_config (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, handle TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT DEFAULT "admin", created_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, user_a TEXT NOT NULL, user_b TEXT NOT NULL, remote_handle TEXT, remote_instance_url TEXT, last_message_snippet TEXT, last_message_at INTEGER NOT NULL, status TEXT DEFAULT "active")',
  'CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, sender_id TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL, read_at INTEGER)',
  'CREATE TABLE IF NOT EXISTS federation_friendships (id TEXT PRIMARY KEY, local_user_id TEXT NOT NULL, remote_handle TEXT NOT NULL, remote_instance_url TEXT NOT NULL, status TEXT DEFAULT "pending", direction TEXT DEFAULT "outgoing", created_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS media_attachments (id TEXT PRIMARY KEY, content_type TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS push_subscriptions (id TEXT PRIMARY KEY, user_handle TEXT NOT NULL, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, user_agent TEXT, created_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS static_inquiries (id TEXT PRIMARY KEY, sender_handle TEXT NOT NULL, sender_name TEXT NOT NULL, sender_root_domain TEXT NOT NULL, sender_origin_url TEXT NOT NULL, content TEXT NOT NULL, status TEXT DEFAULT "pending", created_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS blocked_domains (root_domain TEXT PRIMARY KEY, reason TEXT, blocked_at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS idx_inquiries_root_domain ON static_inquiries(sender_root_domain, status)',
  'CREATE INDEX IF NOT EXISTS idx_inquiries_created ON static_inquiries(created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_push_user_handle ON push_subscriptions(user_handle)',
  'CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_friendships_created_at ON federation_friendships(created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_conversations_user_a ON conversations(user_a, last_message_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_conversations_user_b ON conversations(user_b, last_message_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_token_expires ON sessions(token, expires_at)'
]

export async function ensureD1Database(db: any) {
  if (d1Initialized || !db) return
  try {
    for (const stmt of D1_INIT_STATEMENTS) {
      try {
        await db.prepare(stmt).run()
      } catch (stmtErr: any) {
        console.warn('[D1 stmt warning]', stmtErr?.message)
      }
    }
    d1Initialized = true
  } catch (err: any) {
    console.warn('[D1 Migration Warning]', err?.message)
  }
}

// Normalize URL helper (Ensures https:// and removes trailing slash)
export function normalizeUrl(url: string): string {
  let cleaned = (url || '').trim()
  if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
    cleaned = 'https://' + cleaned
  }
  return cleaned.replace(/\/+$/, '')
}
