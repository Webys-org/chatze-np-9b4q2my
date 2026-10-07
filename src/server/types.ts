export type Bindings = {
  DB?: any // Cloudflare D1 Database binding
  ASSETS?: any // Cloudflare Workers static assets binding
  REALTIME_ROOM?: any // Cloudflare Durable Object binding for 0ms cross-isolate push
  JWT_SECRET?: string
  NODE_ENV?: string
  VAPID_PUBLIC_KEY?: string
  NEXT_PUBLIC_VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
}

export type UserStreamClient = {
  id: string
  userId: string
  write: (data: string) => void
}

export interface MemUser {
  id: string
  handle: string
  display_name: string
  password_hash: string
  role: string
  created_at: number
}

export interface MemSession {
  userId: string
  createdAt: number
  expiresAt: number
}

export interface MemConversation {
  id: string
  user_a: string
  user_b: string
  remote_handle?: string
  remote_instance_url?: string
  last_message_snippet: string | null
  last_message_at: number
  status: string // 'active' | 'pending' | 'archived'
}

export interface MemMessage {
  id: string
  conversation_id: string
  sender_id: string
  content: string
  created_at: number
  read_at: number | null
}

export interface MemFriendship {
  id: string
  local_user_id: string
  remote_handle: string
  remote_instance_url: string
  status: string // 'pending' | 'active' | 'rejected'
  direction: 'incoming' | 'outgoing'
  created_at: number
}

export interface MemMedia {
  id: string
  contentType: string
  data: string
  createdAt: number
}

export interface MemInquiry {
  id: string
  sender_handle: string
  sender_name: string
  sender_root_domain: string
  sender_origin_url: string
  content: string
  status: 'pending' | 'accepted' | 'dismissed'
  created_at: number
}

export interface MemBlockedDomain {
  root_domain: string
  reason?: string
  blocked_at: number
}
