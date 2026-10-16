const DOE_API = 'https://eqms.doe.gov.my/api3/publicportalapims'
const SOURCE = 'Malaysia DOE · MyEQMS/APIMS'
const MAX_STATION_DISTANCE_KM = 100
const DOE_CACHE_MS = 5 * 60 * 1000
const GEOCODE_CACHE_MS = 24 * 60 * 60 * 1000

function asRecords(payload, key) {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object') {
    const data = payload[key] ?? payload.data
    if (Array.isArray(data)) return data
    if (data && typeof data === 'object') return [data]
  }
  return []
}

function numeric(value) {
  if (value === null || value === undefined || value === '' || value === 'N/A' || value === '-') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function firstString(record, keys) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function validTimestamp(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}+08:00`).getTime())
}

function normalizeReading(location, station, current) {
  const index = numeric(current.API ?? current.api)
  const timestamp = firstString(current, ['DATETIME', 'datetime'])
  if (index === null || !validTimestamp(timestamp)) return null

  return {
    status: 'available',
    location,
    station: {
      id: firstString(current, ['STATION_ID', 'station_id']) || station.id,
      name: firstString(current, ['STATION_LOCATION', 'station_location']) || station.name,
      latitude: numeric(current.LATITUDE ?? current.latitude) ?? station.latitude,
      longitude: numeric(current.LONGITUDE ?? current.longitude) ?? station.longitude,
      distanceKm: station.distanceKm,
    },
    index,
    category: firstString(current, ['CLASS', 'class', 'API_CATEGORY']) || null,
    dominantPollutant: firstString(current, ['PARAM_SELECTED', 'param_selected']) || null,
    timestamp,
    source: SOURCE,
    standard: 'Malaysia Air Pollutant Index (API/IPU)',
    pollutants: [],
  }
}

function unavailable(location, reason, station = null) {
  return {
    status: 'unavailable',
    location,
    reason,
    station,
    source: SOURCE,
    standard: 'Malaysia Air Pollutant Index (API/IPU)',
  }
}

function validateLocation(location) {
  if (!location || typeof location !== 'object') return false
  const { name, state, latitude, longitude } = location
  return typeof name === 'string' && name.trim().length > 0 && name.length <= 100
    && typeof state === 'string' && state.trim().length > 0 && state.length <= 100
    && Number.isFinite(latitude) && latitude >= -0.7 && latitude <= 7.5
    && Number.isFinite(longitude) && longitude >= 99.5 && longitude <= 120
}

export function createAirQualityService({
  fetchImpl = fetch,
  now = () => Date.now(),
  maxStationDistanceKm = MAX_STATION_DISTANCE_KM,
  minDoeIntervalMs = 250,
} = {}) {
  const cache = new Map()
  const pending = new Map()
  let doeQueue = Promise.resolve()
  let lastDoeRequestAt = 0

  function cached(key, duration, load) {
    const entry = cache.get(key)
    if (entry && entry.expiresAt > now()) return Promise.resolve(entry.value)
    if (pending.has(key)) return pending.get(key)
    const request = load().then((value) => {
      if (cache.size >= 500) cache.delete(cache.keys().next().value)
      cache.set(key, { value, expiresAt: now() + duration })
      return value
    }).finally(() => pending.delete(key))
    pending.set(key, request)
    return request
  }

  function fetchDoeJson(url) {
    const request = doeQueue.then(async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const delay = Math.max(0, minDoeIntervalMs - (now() - lastDoeRequestAt))
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
        lastDoeRequestAt = now()
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(12_000) })
        if (response.status === 429 && attempt < 2) {
          const retryAfter = Number(response.headers.get('Retry-After'))
          const backoff = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 10_000)
            : 1000 * (attempt + 1)
          await new Promise((resolve) => setTimeout(resolve, backoff))
          continue
        }
        if (!response.ok) throw new Error(`Upstream service returned ${response.status}`)
        return response.json()
      }
      throw new Error('Upstream service rate limit persisted after retries')
    })
    doeQueue = request.catch(() => undefined)
    return request
  }

  async function findStation(latitude, longitude) {
    const key = `station:${latitude.toFixed(4)},${longitude.toFixed(4)}`
    return cached(key, GEOCODE_CACHE_MS, async () => {
      const url = new URL(`${DOE_API}/getstationidbylonglat`)
      url.search = new URLSearchParams({ longitude: String(longitude), latitude: String(latitude) }).toString()
      const payload = await fetchDoeJson(url)
      const station = asRecords(payload, 'data')[0]
      if (!station) return null
      const id = firstString(station, ['STATION_ID', 'station_id', 'stationId'])
      const stationLatitude = numeric(station.LATITUDE ?? station.latitude)
      const stationLongitude = numeric(station.LONGITUDE ?? station.longitude)
      const distanceKm = numeric(station.DISTANCE ?? station.distance)
      if (!id || stationLatitude === null || stationLongitude === null || distanceKm === null) {
        throw new Error('Nearest-station response was incomplete')
      }
      return {
        id,
        latitude: stationLatitude,
        longitude: stationLongitude,
        distanceKm,
        name: firstString(station, ['STATION_LOCATION', 'station_location', 'LOCATION']) || id,
      }
    })
  }

  async function getCurrent(stationId) {
    return cached(`current:${stationId}`, DOE_CACHE_MS, async () => {
      const url = new URL(`${DOE_API}/currentapicurrentlocation`)
      url.search = new URLSearchParams({ stationid: stationId }).toString()
      const payload = await fetchDoeJson(url)
      return asRecords(payload, 'data')[0] ?? null
    })
  }

  async function getReading(location) {
    if (!validateLocation(location)) throw new Error('Location is invalid')
    const normalizedLocation = {
      name: location.name.trim(),
      state: location.state.trim(),
      latitude: location.latitude,
      longitude: location.longitude,
    }
    const station = await findStation(location.latitude, location.longitude)
    if (!station) return unavailable(normalizedLocation, 'no_station')
    const current = await getCurrent(station.id)
    const stationSummary = {
      id: station.id,
      name: firstString(current ?? {}, ['STATION_LOCATION', 'station_location']) || station.name,
      latitude: station.latitude,
      longitude: station.longitude,
      distanceKm: station.distanceKm,
    }
    if (station.distanceKm > maxStationDistanceKm) {
      return unavailable(normalizedLocation, 'too_far', stationSummary)
    }
    if (!current) return unavailable(normalizedLocation, 'reading_unavailable', stationSummary)
    return normalizeReading(normalizedLocation, station, current)
      ?? unavailable(normalizedLocation, 'reading_unavailable', stationSummary)
  }

  async function getHistory(stationId, timestamp) {
    const key = `history:${stationId}:${timestamp}`
    return cached(key, DOE_CACHE_MS, async () => {
      const url = new URL(`${DOE_API}/apitablehourly`)
      url.search = new URLSearchParams({ stationid: stationId, datetime: timestamp }).toString()
      const payload = await fetchDoeJson(url)
      return asRecords(payload, 'api_table_hourly')
        .filter((record) => firstString(record, ['STATION_ID', 'station_id']) === stationId)
        .flatMap((record) => {
          const index = numeric(record.API ?? record.api)
          const datetime = firstString(record, ['DATETIME', 'datetime'])
          return index === null || !datetime ? [] : [{
            timestamp: datetime,
            index,
          }]
        })
        .sort((first, second) => first.timestamp.localeCompare(second.timestamp))
    })
  }

  return { getReading, getHistory }
}
