import { Hono } from 'hono'
import { ensureD1Database } from '../db'
import { memoryStore } from '../store'
import type { Bindings } from '../types'

const mediaRoutes = new Hono<{ Bindings: Bindings }>()

// Lightweight Media Attachment API (Optimized for Free D1 & wsrv.nl)
mediaRoutes.post('/api/media/upload', async (c) => {
  try {
    const { data, contentType } = await c.req.json()
    if (!data || typeof data !== 'string') {
      return c.json({ error: 'Missing media data' }, 400)
    }

    // Safety check: 350 KB payload limit to ensure D1 rows stay super lightweight
    if (data.length > 400 * 1024) {
      return c.json({ error: 'Image exceeds maximum compressed size. Please compress to under 300KB.' }, 400)
    }

    const mediaId = 'med_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4)
    const mime = contentType || 'image/webp'
    const now = Date.now()

    memoryStore.media.set(mediaId, {
      id: mediaId,
      contentType: mime,
      data,
      createdAt: now,
    })

    const db = c.env?.DB
    if (db) {
      try {
        await ensureD1Database(db)
        await db.prepare('INSERT OR REPLACE INTO media_attachments (id, content_type, data, created_at) VALUES (?, ?, ?, ?)')
          .bind(mediaId, mime, data, now).run()
      } catch (d1Err: any) {
        console.warn('[D1 Media Save Warning]', d1Err?.message)
      }
    }

    const reqUrl = new URL(c.req.url)
    const publicUrl = `${reqUrl.protocol}//${reqUrl.host}/api/media/${mediaId}`

    return c.json({
      success: true,
      id: mediaId,
      url: publicUrl,
    }, 201)
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

mediaRoutes.get('/api/media/:id', async (c) => {
  const id = c.req.param('id')
  let mediaRecord = memoryStore.media.get(id)

  const db = c.env?.DB
  if (!mediaRecord && db) {
    try {
      await ensureD1Database(db)
      const row: any = await db.prepare('SELECT * FROM media_attachments WHERE id = ? LIMIT 1').bind(id).first()
      if (row) {
        mediaRecord = {
          id: row.id,
          contentType: row.content_type,
          data: row.data,
          createdAt: row.created_at,
        }
        memoryStore.media.set(id, mediaRecord)
      }
    } catch (d1Err: any) {
      console.warn('[D1 Media Fetch Warning]', d1Err?.message)
    }
  }

  if (!mediaRecord) {
    return c.text('Media not found', 404)
  }

  let base64Content = mediaRecord.data
  if (base64Content.includes(',')) {
    base64Content = base64Content.split(',')[1]
  }

  try {
    const binaryStr = atob(base64Content)
    const bytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i)
    }

    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': mediaRecord.contentType || 'image/webp',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch {
    return c.text('Failed to decode media', 500)
  }
})

export default mediaRoutes
