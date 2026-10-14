import { describe, expect, it, vi } from 'vitest'
import { createWhoNewsLoader, normalizeWhoNewsItem, parseWhoHeadlines } from './who-health-news.ts'

describe('WHO health news normalization', () => {
  it('keeps only up to three dated WHO article links and strips markup', () => {
    const html = `<a href="/news/item/01-01-2026-first">First <b>update</b></a>
      <a href="/news/item/03-01-2026-third">Third &amp; latest</a>
      <a href="/news/item/02-01-2026-second">Second</a>
      <a href="https://example.com/news/item/04-01-2026-fake">Fake</a>
      <a href="/news/item/04-01-2026-fourth">Fourth</a>`
    const items = parseWhoHeadlines(html)
    expect(items).toHaveLength(3)
    expect(items.map(item => item.title)).toEqual(['Fourth', 'Third & latest', 'Second'])
    expect(items.every(item => item.source === 'WHO' && item.article_url.startsWith('https://www.who.int/news/item/'))).toBe(true)
    expect(items[0].summary).toBe('')
  })

  it('rejects unsafe URLs and removes HTML from item fields', () => {
    expect(normalizeWhoNewsItem({ title: 'Nope', article_url: 'https://evil.example/news/item/01-01-2026-x' })).toBeNull()
    expect(normalizeWhoNewsItem({ title: '<b>Safe</b><script>bad()</script>', article_url: 'https://who.int/news/item/01-01-2026-x?tracking=yes' })).toMatchObject({
      title: 'Safe', article_url: 'https://www.who.int/news/item/01-01-2026-x', source: 'WHO',
    })
  })
})

describe('WHO health news cache', () => {
  it('caches successful results and falls back to stale content when refresh fails', async () => {
    let now = 0
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('<a href="/news/item/01-01-2026-update">Update</a>'))
      .mockRejectedValueOnce(new Error('offline'))
    const load = createWhoNewsLoader({ fetchImpl, now: () => now, cacheMs: 100 })
    const first = await load()
    expect(first).toMatchObject({ cached: false, stale: false })
    expect((await load()).cached).toBe(true)
    now = 101
    expect(await load()).toMatchObject({ items: first.items, cached: true, stale: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
