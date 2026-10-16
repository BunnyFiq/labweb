import { handleApiRequest } from './api.js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders,
      ...headers,
    },
  })
}

function cacheRequestKey(url, body) {
  const key = new URL(url)
  if (body) {
    key.pathname = '/__haze_cache/readings'
    key.search = new URLSearchParams({ locations: JSON.stringify(body.locations) }).toString()
    return new Request(key)
  }
  key.pathname = '/__haze_cache/history'
  key.searchParams.sort()
  return new Request(key)
}

export function createWorker({ apiRequest = handleApiRequest, cacheApi } = {}) {
  return {
    async fetch(request, _environment, context) {
      const url = new URL(request.url)
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
      if (!url.pathname.startsWith('/api/')) return jsonResponse(404, { error: 'API route not found.' })

      let body
      if (request.method === 'POST') {
        try {
          body = await request.json()
        } catch {
          return jsonResponse(400, { error: 'Request body must be valid JSON.' })
        }
      }

      const cache = cacheApi ?? globalThis.caches?.default
      const cacheable = (request.method === 'GET' && url.pathname === '/api/history')
        || (request.method === 'POST' && url.pathname === '/api/readings'
          && body && typeof body === 'object' && Array.isArray(body.locations))
      const key = cacheable ? cacheRequestKey(url, body) : null
      if (cache && key) {
        try {
          const hit = await cache.match(key)
          if (hit) return hit
        } catch (error) {
          console.error('Worker response cache lookup failed:', error)
        }
      }

      const result = await apiRequest({
        method: request.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        body,
      })
      const response = jsonResponse(result.status, result.body, result.headers)
      if (cache && key && response.ok) {
        const ttl = Number(/max-age=(\d+)/i.exec(response.headers.get('Cache-Control') ?? '')?.[1] ?? 0)
        if (ttl > 0) {
          const cached = response.clone()
          cached.headers.set('Cache-Control', `public, max-age=${ttl}`)
          const put = cache.put(key, cached).catch((error) => {
            console.error('Worker response cache write failed:', error)
          })
          if (context?.waitUntil) context.waitUntil(put)
          else await put
        }
      }
      return response
    },
  }
}

export default createWorker()
