import { createAirQualityService } from './air-quality.js'

const service = createAirQualityService()
const jsonHeaders = { 'Cache-Control': 'public, max-age=300' }

function response(status, body, headers = jsonHeaders) {
  return { status, headers, body }
}

function failureMessage(error) {
  return error instanceof Error ? error.message : 'The request could not be completed.'
}

export async function handleApiRequest({ method, path, query = {}, body }) {
  if (method === 'POST' && path === '/api/readings') {
    const locations = body && typeof body === 'object' ? body.locations : null
    if (!Array.isArray(locations) || locations.length < 1 || locations.length > 8) {
      return response(400, { error: 'Provide between 1 and 8 Malaysian locations.' })
    }
    if (!locations.every((location) => location && typeof location === 'object'
      && typeof location.name === 'string'
      && typeof location.state === 'string'
      && Number.isFinite(location.latitude)
      && Number.isFinite(location.longitude))) {
      return response(400, { error: 'One or more locations are invalid.' })
    }
    const results = await Promise.all(locations.map(async (location) => {
      try {
        return await service.getReading(location)
      } catch (error) {
        console.error(`DOE reading request failed for ${location.name}:`, failureMessage(error))
        return {
          status: 'error',
          location,
          message: 'The official monitoring service could not provide this reading.',
        }
      }
    }))
    const allFailed = results.every((result) => result.status === 'error')
    return response(allFailed ? 502 : 200, { results })
  }

  if (method === 'GET' && path === '/api/history') {
    const stationId = typeof query.stationId === 'string' ? query.stationId : ''
    const timestamp = typeof query.timestamp === 'string' ? query.timestamp : ''
    if (!/^CA[A-Za-z0-9]{3,5}$/.test(stationId)
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(timestamp)) {
      return response(400, { error: 'A valid station and measurement time are required.' })
    }
    try {
      const history = await service.getHistory(stationId, timestamp)
      return response(200, { history })
    } catch (error) {
      console.error(`DOE hourly history request failed for ${stationId}:`, failureMessage(error))
      return response(502, { error: 'Hourly station history is temporarily unavailable.' })
    }
  }

  return response(404, { error: 'API route not found.' }, { 'Cache-Control': 'no-store' })
}
