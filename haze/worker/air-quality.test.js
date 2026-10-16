import test from 'node:test'
import assert from 'node:assert/strict'
import { createAirQualityService } from './air-quality.js'
import { handleApiRequest } from './api.js'
import worker, { createWorker } from './index.js'

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('reading uses the actual nearest station and Malaysian API/IPU fields', async () => {
  const calls = []
  const service = createAirQualityService({
    fetchImpl: async (url) => {
      calls.push(String(url))
      if (String(url).includes('getstationidbylonglat')) {
        return jsonResponse({ data: [{
          STATION_ID: 'CA16W',
          LATITUDE: 3.10626,
          LONGITUDE: 101.717931,
          DISTANCE: 3.1,
        }] })
      }
      return jsonResponse({ data: [{
        STATION_ID: 'CA16W',
        DATETIME: '2026-10-15T22:00:00',
        API: 170,
        PARAM_SELECTED: 'PM2.5',
        CLASS: 'Unhealthy',
        STATION_LOCATION: 'Cheras, W.P. KUALA LUMPUR',
      }] })
    },
  })
  const reading = await service.getReading({
    name: 'Kuala Lumpur',
    state: 'Federal Territory of Kuala Lumpur',
    latitude: 3.1517,
    longitude: 101.6942,
  })

  assert.equal(reading.status, 'available')
  assert.equal(reading.index, 170)
  assert.equal(reading.category, 'Unhealthy')
  assert.equal(reading.dominantPollutant, 'PM2.5')
  assert.equal(reading.station.name, 'Cheras, W.P. KUALA LUMPUR')
  assert.equal(reading.station.distanceKm, 3.1)
  assert.equal(reading.standard, 'Malaysia Air Pollutant Index (API/IPU)')
  assert.deepEqual(reading.pollutants, [])
  assert.equal(calls.length, 2)
})

test('DOE rate limits are retried before returning a live reading', async () => {
  let stationAttempts = 0
  const service = createAirQualityService({
    minDoeIntervalMs: 0,
    fetchImpl: async (url) => {
      if (String(url).includes('getstationidbylonglat')) {
        stationAttempts += 1
        if (stationAttempts === 1) return new Response(null, { status: 429 })
        return jsonResponse({ data: [{
          STATION_ID: 'CA16W',
          LATITUDE: 3.1,
          LONGITUDE: 101.7,
          DISTANCE: 1,
        }] })
      }
      return jsonResponse({ data: [{
        STATION_ID: 'CA16W',
        DATETIME: '2026-10-15T22:00:00',
        API: 60,
      }] })
    },
  })
  const reading = await service.getReading({
    name: 'Kuala Lumpur',
    state: 'Federal Territory of Kuala Lumpur',
    latitude: 3.139,
    longitude: 101.6869,
  })

  assert.equal(reading.status, 'available')
  assert.equal(stationAttempts, 2)
})

test('locations too far from a station are reported as unavailable, not as city readings', async () => {
  const service = createAirQualityService({
    fetchImpl: async (url) => String(url).includes('getstationidbylonglat')
      ? jsonResponse({ data: [{
        STATION_ID: 'CA01R',
        LATITUDE: 6.44,
        LONGITUDE: 100.19,
        DISTANCE: 142.7,
      }] })
      : jsonResponse({ data: [{
        STATION_ID: 'CA01R',
        API: 56,
        DATETIME: '2026-10-15T22:00:00',
        STATION_LOCATION: 'Kangar, PERLIS',
      }] }),
  })
  const reading = await service.getReading({
    name: 'Remote town',
    state: 'Sarawak',
    latitude: 4,
    longitude: 115,
  })

  assert.equal(reading.status, 'unavailable')
  assert.equal(reading.reason, 'too_far')
  assert.equal(reading.station.distanceKm, 142.7)
  assert.equal(reading.station.name, 'Kangar, PERLIS')
  assert.equal('index' in reading, false)
})

test('missing station and missing current API index are represented as unavailable', async () => {
  const noStationService = createAirQualityService({
    fetchImpl: async () => jsonResponse({ data: [] }),
  })
  const location = { name: 'Island', state: 'Sabah', latitude: 6, longitude: 117 }
  assert.equal((await noStationService.getReading(location)).reason, 'no_station')

  const noReadingService = createAirQualityService({
    fetchImpl: async (url) => String(url).includes('getstationidbylonglat')
      ? jsonResponse({ data: [{ STATION_ID: 'CA16W', LATITUDE: 3.1, LONGITUDE: 101.7, DISTANCE: 1 }] })
      : jsonResponse({ data: [{ STATION_ID: 'CA16W', API: '-', DATETIME: null }] }),
  })
  assert.equal((await noReadingService.getReading(location)).reason, 'reading_unavailable')
})

test('station history includes only actual readings for that station', async () => {
  const service = createAirQualityService({
    fetchImpl: async () => jsonResponse({ api_table_hourly: [
      { STATION_ID: 'CA16W', DATETIME: '2026-10-15T21:00:00', API: 173 },
      { STATION_ID: 'CA16W', DATETIME: '2026-10-15T22:00:00', API: 170 },
      { STATION_ID: 'CA15W', DATETIME: '2026-10-15T22:00:00', API: 160 },
    ] }),
  })
  assert.deepEqual(await service.getHistory('CA16W', '2026-10-15T22:00:00'), [
    { timestamp: '2026-10-15T21:00:00', index: 173 },
    { timestamp: '2026-10-15T22:00:00', index: 170 },
  ])
})

test('API validates location counts and history parameters', async () => {
  assert.equal((await handleApiRequest({
    method: 'POST',
    path: '/api/readings',
    body: { locations: [] },
  })).status, 400)
  assert.equal((await handleApiRequest({
    method: 'GET',
    path: '/api/history',
    query: { stationId: 'invalid', timestamp: 'yesterday' },
  })).status, 400)
  assert.equal((await handleApiRequest({
    method: 'GET',
    path: '/missing',
  })).status, 404)
  assert.equal((await handleApiRequest({
    method: 'POST',
    path: '/api/readings',
    body: { locations: Array.from({ length: 9 }, () => ({})) },
  })).status, 400)
})

test('Worker serves public-data CORS preflight and response headers', async () => {
  const preflight = await worker.fetch(new Request('https://api.example/api/readings', {
    method: 'OPTIONS',
    headers: { Origin: 'https://haze-75b87.web.app' },
  }))
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), '*')

  const app = createWorker({
    apiRequest: async () => ({ status: 200, headers: {}, body: { results: [] } }),
  })
  const response = await app.fetch(new Request('https://api.example/api/readings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locations: [] }),
  }))
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*')
  assert.deepEqual(await response.json(), { results: [] })
})

test('Worker caches successful reading responses by request body', async () => {
  const entries = new Map()
  const cacheApi = {
    async match(key) {
      return entries.get(key.url)?.clone()
    },
    async put(key, response) {
      entries.set(key.url, response.clone())
    },
  }
  let calls = 0
  const app = createWorker({
    cacheApi,
    apiRequest: async () => {
      calls += 1
      return { status: 200, headers: { 'Cache-Control': 'public, max-age=300' }, body: { results: [] } }
    },
  })
  const createRequest = () => new Request('https://api.example/api/readings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locations: [{ name: 'Kuala Lumpur' }] }),
  })
  assert.equal((await app.fetch(createRequest())).status, 200)
  assert.equal((await app.fetch(createRequest())).status, 200)
  assert.equal(calls, 1)
  assert.ok([...entries.keys()][0].startsWith('https://api.example/__haze_cache/readings'))
})
