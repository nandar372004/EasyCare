import { supabase } from '../lib/supabase.js'

const WHO_ARTICLE = /^https:\/\/www\.who\.int\/news\/item\/[a-z0-9-]+\/?$/i

function text(value, limit) {
  if (typeof value !== 'string') return ''
  return value.replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit).trim()
}

function normalizeItem(item) {
  if (!item || typeof item !== 'object' || typeof item.article_url !== 'string' || !WHO_ARTICLE.test(item.article_url)) return null
  const title = text(item.title, 180)
  if (!title) return null
  const date = typeof item.published_at === 'string' && Number.isFinite(Date.parse(item.published_at))
    ? new Date(item.published_at).toISOString()
    : null
  return { title, source: 'WHO', published_at: date, summary: text(item.summary, 220), article_url: item.article_url }
}

export async function getHealthWorldNews(client = supabase) {
  if (!client) throw new Error('Health updates are temporarily unavailable.')
  const { data, error } = await client.functions.invoke('health-world-news', { body: {} })
  if (error) throw new Error('Health updates are temporarily unavailable.')
  const raw = Array.isArray(data?.items) ? data.items : []
  return {
    items: raw.map(normalizeItem).filter(Boolean).slice(0, 3),
    cached: data?.cached === true,
    stale: data?.stale === true,
  }
}
