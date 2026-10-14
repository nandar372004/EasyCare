import { describe, expect, it, vi } from 'vitest'
import { getHealthWorldNews } from './healthWorldNewsService.js'

describe('getHealthWorldNews', () => {
  it('invokes the public news function without patient data and validates returned items', async () => {
    const client = { functions: { invoke: vi.fn().mockResolvedValue({ data: {
      items: [
        { title: '<b>WHO update</b>', article_url: 'https://www.who.int/news/item/01-01-2026-update', published_at: '2026-01-01' },
        { title: 'Unsafe', article_url: 'https://example.com/news/item/01-01-2026-x' },
      ], cached: true, stale: false,
    }, error: null }) } }
    await expect(getHealthWorldNews(client)).resolves.toMatchObject({
      items: [{ title: 'WHO update', source: 'WHO', article_url: 'https://www.who.int/news/item/01-01-2026-update' }],
      cached: true, stale: false,
    })
    expect(client.functions.invoke).toHaveBeenCalledWith('health-world-news', { body: {} })
  })
})
