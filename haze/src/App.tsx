import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import './App.css'

type City = {
  name: string
  state: string
  latitude: number
  longitude: number
}

type SearchLocation = City & { id: string }

type Station = {
  id: string
  name: string
  latitude: number
  longitude: number
  distanceKm: number
}

type ReadingStatus = 'loading' | 'available' | 'unavailable' | 'error'

type AirReading = {
  status: ReadingStatus
  location: City
  station?: Station | null
  index?: number
  category?: string | null
  dominantPollutant?: string | null
  timestamp?: string
  source?: string
  standard?: string
  pollutants?: Array<{ name: string; value: number; units: string }>
  reason?: 'no_station' | 'too_far' | 'reading_unavailable'
  message?: string
}

type CityReading = {
  city: City
  result: AirReading
}

type HistoryPoint = {
  timestamp: string
  index: number
}

type AqiCategory = {
  label: string
  badgeClass: string
  backgroundClass: string
  advice: string
}

const cities: City[] = [
  { name: 'Kota Bharu', state: 'Kelantan', latitude: 6.1256, longitude: 102.2381 },
  { name: 'Kuala Lumpur', state: 'Federal Territory of Kuala Lumpur', latitude: 3.139, longitude: 101.6869 },
  { name: 'Shah Alam', state: 'Selangor', latitude: 3.0738, longitude: 101.5183 },
  { name: 'George Town', state: 'Penang', latitude: 5.4141, longitude: 100.3288 },
  { name: 'Ipoh', state: 'Perak', latitude: 4.5975, longitude: 101.0901 },
  { name: 'Johor Bahru', state: 'Johor', latitude: 1.4927, longitude: 103.7414 },
  { name: 'Melaka', state: 'Melaka', latitude: 2.1896, longitude: 102.2501 },
  { name: 'Kuantan', state: 'Pahang', latitude: 3.8077, longitude: 103.326 },
  { name: 'Kuala Terengganu', state: 'Terengganu', latitude: 5.3302, longitude: 103.1408 },
  { name: 'Alor Setar', state: 'Kedah', latitude: 6.1248, longitude: 100.3678 },
  { name: 'Kuching', state: 'Sarawak', latitude: 1.5533, longitude: 110.3592 },
  { name: 'Kota Kinabalu', state: 'Sabah', latitude: 5.9804, longitude: 116.0735 },
]

const loadingResults: CityReading[] = cities.map((city) => ({
  city,
  result: { status: 'loading', location: city },
}))

function getAqiCategory(aqi: number, sourceCategory?: string | null): AqiCategory {
  if (aqi <= 50) {
    return {
      label: sourceCategory || 'Good',
      badgeClass: 'badge-success',
      backgroundClass: 'haze-good',
      advice: 'Air quality is good. Enjoy your usual outdoor activities.',
    }
  }
  if (aqi <= 100) {
    return {
      label: sourceCategory || 'Moderate',
      badgeClass: 'badge-warning',
      backgroundClass: 'haze-moderate',
      advice: 'Air quality is acceptable. Sensitive people may wish to limit prolonged outdoor activity.',
    }
  }
  if (aqi <= 200) {
    return {
      label: sourceCategory || 'Unhealthy',
      badgeClass: 'badge-unhealthy-sensitive',
      backgroundClass: 'haze-sensitive',
      advice: 'Reduce prolonged or heavy outdoor activity, especially if you are sensitive to air pollution.',
    }
  }
  if (aqi <= 300) {
    return {
      label: sourceCategory || 'Very Unhealthy',
      badgeClass: 'badge-error',
      backgroundClass: 'haze-very-unhealthy',
      advice: 'Reduce outdoor activity and avoid strenuous exercise outdoors.',
    }
  }
  return {
    label: sourceCategory || 'Hazardous',
    badgeClass: 'badge-hazardous',
    backgroundClass: 'haze-hazardous',
    advice: 'Avoid outdoor activity, stay indoors with windows closed, and follow official health guidance.',
  }
}

function formatMeasurement(value: number | null | undefined): string {
  return value == null ? '—' : value.toFixed(1)
}

function parseMalaysiaTimestamp(value: string): Date {
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
  return new Date(hasTimezone ? value : `${value}+08:00`)
}

function formatMalaysiaTime(value: string | undefined, options: Intl.DateTimeFormatOptions = {}): string {
  if (!value) return '—'
  const date = parseMalaysiaTimestamp(value)
  if (Number.isNaN(date.getTime())) return 'Time unavailable'
  const defaults = options.dateStyle || options.timeStyle
    ? {}
    : { hour: '2-digit' as const, minute: '2-digit' as const }
  return new Intl.DateTimeFormat('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    ...defaults,
    ...options,
  }).format(date)
}

function formatTimestampAttribute(value: string | undefined): string | undefined {
  if (!value) return undefined
  const date = parseMalaysiaTimestamp(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function isStaleReading(timestamp: string | undefined): boolean {
  if (!timestamp) return true
  const measuredAt = parseMalaysiaTimestamp(timestamp).getTime()
  return Number.isNaN(measuredAt) || Date.now() - measuredAt > 2 * 60 * 60 * 1000
}

function loadFavoriteCities(): { cities: string[]; message: string } {
  try {
    const saved = window.localStorage.getItem('haze-favorite-cities')
    if (!saved) return { cities: [], message: '' }
    const parsed: unknown = JSON.parse(saved)
    if (!Array.isArray(parsed) || !parsed.every((name) => typeof name === 'string')) {
      return { cities: [], message: 'Saved favorites could not be read. You can still update them.' }
    }
    return {
      cities: parsed.filter((name) => cities.some((city) => city.name === name)),
      message: '',
    }
  } catch {
    return { cities: [], message: 'Saved favorites are unavailable in this browser session.' }
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')
  const response = await fetch(`${apiBaseUrl}${url}`, init)
  const payload: unknown = await response.json()
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload
      && typeof payload.error === 'string'
      ? payload.error
      : `Request failed (${response.status}).`
    throw new Error(message)
  }
  return payload as T
}

async function fetchReadings(locations: City[], signal?: AbortSignal): Promise<AirReading[]> {
  const readings: AirReading[] = []
  for (let offset = 0; offset < locations.length; offset += 8) {
    const batch = locations.slice(offset, offset + 8)
    const payload = await fetchJson<{ results: AirReading[] }>('/api/readings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations: batch }),
      signal,
    })
    if (!Array.isArray(payload.results) || payload.results.length !== batch.length) {
      throw new Error('The official monitoring service returned an incomplete response.')
    }
    readings.push(...payload.results)
  }
  return readings
}

function SearchReadingCard({
  location,
  reading,
  loading,
  error,
  onRefresh,
}: {
  location: SearchLocation
  reading: AirReading | null
  loading: boolean
  error: string
  onRefresh: () => void
}) {
  const hasStaleReading = reading?.status === 'available' && isStaleReading(reading.timestamp)

  return (
    <div className="search-result-card" aria-live="polite">
      <div className="search-result-heading">
        <div>
          <p className="eyebrow section-eyebrow">SELECTED LOCATION</p>
          <h3>{location.name}<span>, {location.state}</span></h3>
        </div>
        <button type="button" className="text-button" onClick={onRefresh} disabled={loading}>
          {loading ? 'Checking…' : 'Refresh reading'}
        </button>
      </div>

      {loading ? (
        <div className="search-reading-state" role="status">
          <span className="loading loading-spinner loading-sm" aria-hidden="true" />
          Checking nearby official monitoring stations…
        </div>
      ) : error ? (
        <div className="search-reading-state is-error" role="alert">
          <span>{error}</span>
          <button type="button" className="text-button" onClick={onRefresh}>Try again</button>
        </div>
      ) : reading?.status === 'unavailable' ? (
        <div className="search-reading-state is-unavailable" role="status">
          <div>
            <strong>{reading.reason === 'no_station'
              ? 'No official monitoring station was returned for this location.'
              : reading.reason === 'too_far'
                ? 'No suitable nearby station is available.'
                : 'The nearest station has no current published reading.'}</strong>
            <p>
              {reading.station
                ? `Nearest station: ${reading.station.name}, approximately ${formatMeasurement(reading.station.distanceKm)} km away. Its reading is not shown because it is outside the 100 km coverage limit or unavailable.`
                : 'No nearby station data is available from the official feed.'}
            </p>
          </div>
        </div>
      ) : reading?.status === 'error' ? (
        <div className="search-reading-state is-error" role="alert">
          {reading.message || 'The official monitoring service could not provide this reading.'}
        </div>
      ) : reading?.status === 'available' ? (
        <>
          <div className="search-result-data">
            <div className="search-result-index">
              <span className="city-aqi-label">MALAYSIA API/IPU</span>
              <strong>{reading.index}</strong>
              <span className={`status-pill ${getAqiCategory(reading.index ?? 0, reading.category).badgeClass}`}>
                {getAqiCategory(reading.index ?? 0, reading.category).label}
              </span>
            </div>
            <div className="search-result-station">
              <span>OFFICIAL STATION MEASUREMENT</span>
              <strong>{reading.station?.name || 'Station name unavailable'}</strong>
              <p>Approximately {formatMeasurement(reading.station?.distanceKm)} km from the searched location. This is a station reading, not a measurement for every part of the city.</p>
            </div>
          </div>
          <div className="search-result-meta">
            <span>
              {hasStaleReading && <strong className="stale-label">STALE · </strong>}
              Measured <time dateTime={formatTimestampAttribute(reading.timestamp)}>
                {formatMalaysiaTime(reading.timestamp, { dateStyle: 'medium' })} · {formatMalaysiaTime(reading.timestamp)} MYT
              </time>
            </span>
            <span>{reading.source} · Malaysian Air Pollutant Index</span>
            {reading.dominantPollutant && <span>Dominant pollutant: {reading.dominantPollutant}</span>}
          </div>
          <p className="pollutant-disclosure">
            {reading.pollutants?.length
              ? reading.pollutants.map((pollutant) => `${pollutant.name}: ${formatMeasurement(pollutant.value)} ${pollutant.units}`).join(' · ')
              : 'Individual pollutant concentrations are not included in the current APIMS station response.'}
          </p>
        </>
      ) : null}
    </div>
  )
}

function IpuTrend({ stationId, timestamp, refreshKey }: {
  stationId: string
  timestamp: string
  refreshKey: number
}) {
  const [state, setState] = useState<{
    stationId: string
    timestamp: string
    refreshKey: number
    status: 'loading' | 'ready' | 'error'
    points: HistoryPoint[]
  }>({ stationId: '', timestamp: '', refreshKey: -1, status: 'loading', points: [] })

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ stationId, timestamp })
    fetchJson<{ history: HistoryPoint[] }>(`/api/history?${params}`, { signal: controller.signal })
      .then((payload) => {
        if (!Array.isArray(payload.history)) throw new Error('Station history was incomplete.')
        setState({ stationId, timestamp, refreshKey, status: 'ready', points: payload.history })
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setState({ stationId, timestamp, refreshKey, status: 'error', points: [] })
        console.error('Could not load official hourly IPU history:', cause)
      })
    return () => controller.abort()
  }, [stationId, timestamp, refreshKey])

  const isCurrentRequest = state.stationId === stationId
    && state.timestamp === timestamp
    && state.refreshKey === refreshKey

  if (!isCurrentRequest || state.status === 'loading') {
    return <p className="forecast-empty" role="status">Loading hourly station readings…</p>
  }
  if (state.status === 'error') {
    return <p className="forecast-empty" role="alert">Hourly station history is unavailable. Refresh the city readings to try again.</p>
  }
  if (state.points.length === 0) {
    return <p className="forecast-empty">No hourly history is available for this station.</p>
  }

  const max = Math.max(...state.points.map((point) => point.index), 1)
  return (
    <div className="trend-chart">
      <div className="trend-bars" role="img" aria-label={`Hourly Malaysian Air Pollutant Index readings for station ${stationId}`}>
        {state.points.map((point) => {
          const height = Math.max((point.index / max) * 100, 3)
          return (
            <div className="trend-point" key={point.timestamp}>
              <span className="trend-value">{point.index}</span>
              <div
                className="trend-bar"
                style={{ height: `${height}%` }}
                title={`${formatMalaysiaTime(point.timestamp, { dateStyle: 'medium' })} ${formatMalaysiaTime(point.timestamp)} MYT · API/IPU ${point.index}`}
              />
              <span className="trend-time">{formatMalaysiaTime(point.timestamp)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function App() {
  const [readings, setReadings] = useState<CityReading[]>(loadingResults)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [selectedCity, setSelectedCity] = useState('Kuala Lumpur')
  const [sortOrder, setSortOrder] = useState<'aqi' | 'alphabetical'>('aqi')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [search, setSearch] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [favoriteState, setFavoriteState] = useState(loadFavoriteCities)
  const [citySearch, setCitySearch] = useState('')
  const [suggestions, setSuggestions] = useState<SearchLocation[]>([])
  const [searchStatus, setSearchStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  const [searchError, setSearchError] = useState('')
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
  const [selectedLocation, setSelectedLocation] = useState<SearchLocation | null>(null)
  const [searchReading, setSearchReading] = useState<AirReading | null>(null)
  const [searchReadingStatus, setSearchReadingStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  const [searchReadingError, setSearchReadingError] = useState('')
  const searchSequence = useRef(0)
  const searchController = useRef<AbortController | null>(null)

  const loadReadings = useCallback(async () => {
    setRefreshing(true)
    try {
      const results = await fetchReadings(cities)
      const updated = results.map((result, index) => ({ city: cities[index], result }))
      setReadings((previous) => updated.map((entry) => {
        const prior = previous.find(({ city }) => city.name === entry.city.name)
        return entry.result.status === 'error' && prior?.result.status === 'available'
          ? prior
          : entry
      }))
      setLastUpdated(new Date())
      const failures = results.filter((result) => result.status === 'error')
      setError(failures.length > 0
        ? `${failures.length} of ${cities.length} city readings could not be updated.`
        : '')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The official air-quality data could not be loaded.'
      setError(message)
      setReadings((previous) => previous.map((entry) => entry.result.status === 'loading'
        ? { ...entry, result: { ...entry.result, status: 'error', message } }
        : entry))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    const initialFetch = window.setTimeout(() => void loadReadings(), 0)
    const interval = window.setInterval(() => void loadReadings(), 60 * 60 * 1000)
    return () => {
      window.clearTimeout(initialFetch)
      window.clearInterval(interval)
    }
  }, [loadReadings])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    const query = citySearch.trim()
    const selectedLabel = selectedLocation ? `${selectedLocation.name}, ${selectedLocation.state}` : ''
    if (query.length < 3 || query === selectedLabel) return

    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      setSearchStatus('loading')
      setSearchError('')
      import('./malaysian-locations.js')
        .then(({ searchMalaysianLocations }) => {
          if (controller.signal.aborted) return
          setSuggestions(searchMalaysianLocations(query))
          setSearchStatus('loaded')
          setActiveSuggestion(-1)
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return
          setSuggestions([])
          setSearchStatus('error')
          setSearchError(cause instanceof Error ? cause.message : 'City search is temporarily unavailable.')
        })
    }, 150)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [citySearch, selectedLocation])

  const sortedReadings = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    const visibleReadings = readings.filter((reading) => {
      const matchesSearch = `${reading.city.name} ${reading.city.state}`.toLocaleLowerCase().includes(query)
      const matchesFavorite = !favoritesOnly || favoriteState.cities.includes(reading.city.name)
      return matchesSearch && matchesFavorite
    })
    return visibleReadings.sort((first, second) => {
      if (sortOrder === 'alphabetical') return first.city.name.localeCompare(second.city.name)
      const firstIndex = first.result.status === 'available' ? first.result.index ?? -1 : -1
      const secondIndex = second.result.status === 'available' ? second.result.index ?? -1 : -1
      return secondIndex - firstIndex
    })
  }, [readings, search, favoritesOnly, favoriteState.cities, sortOrder])

  const selectedReading = readings.find((reading) => reading.city.name === selectedCity)
  const availableReadings = readings.filter((reading) => reading.result.status === 'available')
  const worstReading = availableReadings.reduce<CityReading | null>((worst, reading) => (
    !worst || (reading.result.index ?? 0) > (worst.result.index ?? 0) ? reading : worst
  ), null)
  const worstAqi = worstReading?.result.index ?? 0
  const backgroundClass = getAqiCategory(worstAqi, worstReading?.result.category).backgroundClass
  const affectedCities = availableReadings.filter((reading) => (reading.result.index ?? 0) > 100)

  async function loadSearchReading(location: SearchLocation) {
    searchController.current?.abort()
    const controller = new AbortController()
    searchController.current = controller
    const sequence = ++searchSequence.current
    setSearchReading(null)
    setSearchReadingError('')
    setSearchReadingStatus('loading')
    try {
      const results = await fetchReadings([location], controller.signal)
      if (sequence !== searchSequence.current || controller.signal.aborted) return
      const result = results[0]
      if (!result) throw new Error('The official monitoring service returned no result.')
      setSearchReading(result)
      setSearchReadingStatus(result.status === 'error' ? 'error' : 'loaded')
      if (result.status === 'error') setSearchReadingError(result.message || 'The official monitoring service could not provide this reading.')
    } catch (cause) {
      if (controller.signal.aborted) return
      setSearchReadingStatus('error')
      setSearchReadingError(cause instanceof Error ? cause.message : 'The official air-quality data could not be loaded.')
    }
  }

  function handleCitySearchChange(value: string) {
    searchController.current?.abort()
    searchSequence.current += 1
    setCitySearch(value)
    setSuggestions([])
    setActiveSuggestion(-1)
    setSearchStatus('idle')
    setSearchError('')
    setSelectedLocation(null)
    setSearchReading(null)
    setSearchReadingStatus('idle')
    setSearchReadingError('')
  }

  function selectSearchLocation(location: SearchLocation) {
    setSelectedLocation(location)
    setCitySearch(`${location.name}, ${location.state}`)
    setSuggestions([])
    setSearchStatus('idle')
    setActiveSuggestion(-1)
    void loadSearchReading(location)
  }

  function toggleFavorite(cityName: string) {
    const isFavorite = favoriteState.cities.includes(cityName)
    const nextCities = isFavorite
      ? favoriteState.cities.filter((name) => name !== cityName)
      : [...favoriteState.cities, cityName]
    let message = ''
    try {
      window.localStorage.setItem('haze-favorite-cities', JSON.stringify(nextCities))
    } catch {
      message = 'Favorites could not be saved in this browser session.'
    }
    setFavoriteState({ cities: nextCities, message })
  }

  function onCitySearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && suggestions.length > 0) {
      event.preventDefault()
      setActiveSuggestion((current) => (current + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp' && suggestions.length > 0) {
      event.preventDefault()
      setActiveSuggestion((current) => (current <= 0 ? suggestions.length - 1 : current - 1))
    } else if (event.key === 'Enter' && activeSuggestion >= 0) {
      event.preventDefault()
      selectSearchLocation(suggestions[activeSuggestion])
    } else if (event.key === 'Escape') {
      setSuggestions([])
      setActiveSuggestion(-1)
    }
  }

  return (
    <div className={`app-shell haze-background ${backgroundClass}`}>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Haze, Malaysia air quality dashboard">
          <span className="brand-mark" aria-hidden="true">h</span>
          <span className="brand-name">haze<span>.</span></span>
        </a>
        <nav className="site-nav" aria-label="Main navigation">
          <a href="#overview">City overview</a>
          <a href="#city-details">Health & history</a>
        </nav>
        <div className="header-actions">
          <span className="updated-label" aria-live="polite">
            <span className={`live-dot${lastUpdated ? '' : ' is-waiting'}`} aria-hidden="true" />
            {lastUpdated
              ? <>Checked <time dateTime={lastUpdated.toISOString()}>{lastUpdated.toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' })} MYT</time></>
              : 'Waiting for published data'}
          </span>
          <button
            type="button"
            className="icon-button theme-toggle"
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          >
            <span aria-hidden="true">{theme === 'light' ? '◐' : '☼'}</span>
            <span>{theme === 'light' ? 'Dark' : 'Light'}</span>
          </button>
          <button
            type="button"
            className="refresh-button"
            onClick={() => void loadReadings()}
            disabled={refreshing}
          >
            {refreshing ? <span className="loading loading-spinner loading-xs" aria-hidden="true" /> : <span aria-hidden="true">↻</span>}
            {refreshing ? 'Updating' : 'Refresh'}
          </button>
        </div>
      </header>

      <main id="top" className="dashboard">
        <section className="hero-panel" aria-labelledby="page-title">
          <div className="hero-copy">
            <p className="eyebrow"><span className="eyebrow-line" /> MALAYSIA AIR QUALITY · DOE APIMS</p>
            <h1 id="page-title">Breathe easier.<br /><span>Know your air.</span></h1>
            <p className="hero-description">A clear picture of the latest published air-pollutant index across Malaysia.</p>
            <a className="hero-link" href="#overview">Explore city conditions <span aria-hidden="true">↓</span></a>
          </div>
          <div className="hero-reading">
            {loading && availableReadings.length === 0 ? (
              <div className="hero-loading" role="status">Checking official stations…</div>
            ) : worstReading ? (
              <>
                <div className="reading-topline">
                  <span>HIGHEST DEFAULT-CITY IPU</span>
                  <span className={`status-pill ${getAqiCategory(worstAqi, worstReading.result.category).badgeClass}`}>
                    {getAqiCategory(worstAqi, worstReading.result.category).label}
                  </span>
                </div>
                <div className="hero-aqi">{worstAqi}<span>MALAYSIA API/IPU</span></div>
                <p className="worst-city">{worstReading.city.name}<span>, {worstReading.city.state}</span></p>
                <p className="hero-advice">{getAqiCategory(worstAqi, worstReading.result.category).advice}</p>
              </>
            ) : (
              <>
                <div className="reading-topline"><span>LATEST PUBLISHED DATA</span><span className="status-pill status-neutral">NO READINGS</span></div>
                <p className="hero-empty">Your air, at a glance.</p>
                <p className="hero-advice">The official station feed has not returned a current reading yet.</p>
              </>
            )}
            <div className="hero-meta">
              <span><span className="meta-dot" /> Malaysia DOE · MyEQMS/APIMS</span>
              <span>{availableReadings.length} of {cities.length} default cities reporting</span>
            </div>
          </div>
          <div className="hero-orbit orbit-one" aria-hidden="true" />
          <div className="hero-orbit orbit-two" aria-hidden="true" />
        </section>

        <section className="metric-strip" aria-label="Malaysia air quality summary">
          <div className="metric-item">
            <span className="metric-icon metric-icon-green" aria-hidden="true">◉</span>
            <div><span className="metric-label">DEFAULT CITIES</span><strong>{cities.length}</strong></div>
            <span className="metric-context">plus Malaysia-wide search</span>
          </div>
          <div className="metric-item">
            <span className="metric-icon metric-icon-amber" aria-hidden="true">⌁</span>
            <div><span className="metric-label">ELEVATED IPU</span><strong>{affectedCities.length}</strong></div>
            <span className="metric-context">above 100</span>
          </div>
          <div className="metric-item">
            <span className="metric-icon metric-icon-blue" aria-hidden="true">◷</span>
            <div><span className="metric-label">LAST CHECKED</span><strong className="metric-time">{lastUpdated ? lastUpdated.toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' }) : '—'}</strong></div>
            <span className="metric-context">{lastUpdated ? 'MYT' : 'not checked yet'}</span>
          </div>
        </section>

        <section className="malaysia-search-section" aria-labelledby="malaysia-search-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow section-eyebrow">BEYOND THE DEFAULT CITIES</p>
              <h2 id="malaysia-search-title">Search anywhere in Malaysia</h2>
              <p className="section-subtitle">Find a town or city in any state or federal territory, then check its nearest official station.</p>
            </div>
          </div>
          <div className="malaysia-search-control">
            <label className="malaysia-search-input">
              <span className="search-icon" aria-hidden="true">⌕</span>
              <span className="visually-hidden">Search Malaysian cities and towns</span>
              <input
                type="search"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={suggestions.length > 0}
                aria-controls="malaysia-city-suggestions"
                aria-activedescendant={activeSuggestion >= 0 ? `malaysia-city-option-${activeSuggestion}` : undefined}
                placeholder="Search a Malaysian city or town"
                value={citySearch}
                onChange={(event) => handleCitySearchChange(event.target.value)}
                onKeyDown={onCitySearchKeyDown}
                autoComplete="off"
              />
              {citySearch && <button type="button" className="clear-search" onClick={() => handleCitySearchChange('')} aria-label="Clear Malaysian city search">×</button>}
              {suggestions.length > 0 && (
                <ul id="malaysia-city-suggestions" className="city-suggestions" role="listbox">
                  {suggestions.map((suggestion, index) => (
                    <li key={suggestion.id} role="presentation">
                      <button
                        id={`malaysia-city-option-${index}`}
                        type="button"
                        role="option"
                        aria-selected={activeSuggestion === index}
                        className={activeSuggestion === index ? 'is-active' : ''}
                        onClick={() => selectSearchLocation(suggestion)}
                      >
                        <span>{suggestion.name}</span><small>{suggestion.state}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </label>
            <span className="search-progress" aria-live="polite">
              {searchStatus === 'loading' && <><span className="loading loading-spinner loading-xs" aria-hidden="true" /> Searching Malaysian towns…</>}
              {searchStatus === 'idle' && citySearch.trim().length > 0 && citySearch.trim().length < 3 && 'Enter at least 3 characters'}
            </span>
          </div>
          {searchError && <p className="search-message is-error" role="alert">{searchError}</p>}
          {!searchError && searchStatus === 'loaded' && suggestions.length === 0 && citySearch.trim().length >= 3 && !selectedLocation && (
            <p className="search-message" role="status">No Malaysian cities or towns matched that search. Try another spelling or add a state name.</p>
          )}
          {selectedLocation && (
            <SearchReadingCard
              location={selectedLocation}
              reading={searchReading}
              loading={searchReadingStatus === 'loading'}
              error={searchReadingError}
              onRefresh={() => void loadSearchReading(selectedLocation)}
            />
          )}
          <p className="search-attribution">Place data: <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a>, licensed under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>. Pollution measurements: Malaysia DOE official stations.</p>
        </section>

        {affectedCities.length > 0 && (
          <div role="status" className="haze-notice">
            <span className="notice-icon" aria-hidden="true">!</span>
            <p><strong>Elevated readings detected</strong> Malaysia API/IPU is above 100 at stations nearest to {affectedCities.map((reading) => reading.city.name).join(', ')}.</p>
            <a href="#city-details">See health guidance <span aria-hidden="true">→</span></a>
          </div>
        )}

        {error && (
          <div role="alert" className="error-banner">
            <span>{readings.some((reading) => reading.result.status === 'available')
              ? `Some station readings could not be updated: ${error}`
              : `Unable to load official station readings: ${error}`}</span>
            <button type="button" className="text-button" onClick={() => void loadReadings()} disabled={refreshing}>
              {refreshing ? 'Retrying…' : 'Try again'}
            </button>
          </div>
        )}

        {favoriteState.message && <p className="storage-notice" role="status">{favoriteState.message}</p>}

        <section id="overview" aria-labelledby="overview-title" className="overview-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow section-eyebrow">YOUR DAILY SNAPSHOT</p>
              <h2 id="overview-title">City overview<span className="heading-count">{cities.length}</span></h2>
              <p className="section-subtitle">Latest official Malaysian Air Pollutant Index (API/IPU) from the nearest DOE station to each city.</p>
            </div>
          </div>

          <div className="toolbar">
            <label className="search-field">
              <span className="search-icon" aria-hidden="true">⌕</span>
              <span className="visually-hidden">Filter the default city cards</span>
              <input
                type="search"
                placeholder="Filter listed cities"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search && <button type="button" className="clear-search" onClick={() => setSearch('')} aria-label="Clear city filter">×</button>}
            </label>
            <button
              type="button"
              className={`filter-button${favoritesOnly ? ' is-active' : ''}`}
              aria-pressed={favoritesOnly}
              onClick={() => setFavoritesOnly((previous) => !previous)}
            >
              <span aria-hidden="true">★</span> Favorites
              {favoriteState.cities.length > 0 && <span className="favorite-count">{favoriteState.cities.length}</span>}
            </button>
            <label className="sort-control">
              <span>Sort:</span>
              <select
                aria-label="Sort default city readings"
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value as 'aqi' | 'alphabetical')}
              >
                <option value="aqi">Highest IPU</option>
                <option value="alphabetical">A–Z</option>
              </select>
            </label>
          </div>

          {loading && readings.every((reading) => reading.result.status === 'loading') ? (
            <div className="city-grid" aria-label="Loading city air quality" aria-busy="true">
              {cities.slice(0, 8).map((city) => (
                <div className="city-card city-skeleton" key={city.name}>
                  <div className="skeleton-card-line skeleton-city-name" />
                  <div className="skeleton-card-line skeleton-aqi" />
                  <div className="skeleton-card-line skeleton-category" />
                  <div className="skeleton-card-line skeleton-measurement" />
                </div>
              ))}
            </div>
          ) : sortedReadings.length > 0 ? (
            <div className="city-grid">
              {sortedReadings.map(({ city, result }) => {
                const isFavorite = favoriteState.cities.includes(city.name)
                const isSelected = selectedCity === city.name
                const hasIndex = result.status === 'available' && result.index != null
                const category = hasIndex ? getAqiCategory(result.index ?? 0, result.category) : null
                return (
                  <article className={`city-card${isSelected ? ' is-selected' : ''}`} key={city.name}>
                    <div className="city-card-head">
                      <div>
                        <p className="city-state">{city.state}</p>
                        <h3>{city.name}</h3>
                      </div>
                      <button
                        type="button"
                        className={`favorite-button${isFavorite ? ' is-favorite' : ''}`}
                        aria-label={`${isFavorite ? 'Remove' : 'Add'} ${city.name} ${isFavorite ? 'from' : 'to'} favorites`}
                        aria-pressed={isFavorite}
                        onClick={() => toggleFavorite(city.name)}
                      >
                        <span aria-hidden="true">{isFavorite ? '★' : '☆'}</span>
                      </button>
                    </div>
                    <button
                      type="button"
                      className="city-card-main"
                      aria-label={hasIndex
                        ? `View details for ${city.name}, Malaysia API/IPU ${result.index}, ${category?.label}`
                        : `View station status for ${city.name}`}
                      aria-pressed={isSelected}
                      onClick={() => setSelectedCity(city.name)}
                    >
                      <span className="city-aqi-label">MALAYSIA API/IPU</span>
                      <span className="city-aqi">{hasIndex ? result.index : '—'}</span>
                      {category
                              ? <span className={`status-pill ${category.badgeClass}`}>
                                {category.label}{isStaleReading(result.timestamp) ? ' · Stale' : ''}
                              </span>
                        : <span className="status-pill status-neutral">{result.status === 'loading' ? 'Checking' : result.status === 'error' ? 'Error' : 'No data'}</span>}
                    </button>
                    <div className="city-measurements station-summary">
                      {result.status === 'available' ? (
                        <>
                          <span className="station-name">{result.station?.name || 'Station name unavailable'}</span>
                          <span>~{formatMeasurement(result.station?.distanceKm)} km</span>
                        </>
                      ) : result.status === 'loading' ? (
                        <span>Checking official stations…</span>
                      ) : result.status === 'error' ? (
                        <span>{result.message || 'Connection error'}</span>
                      ) : (
                        <span>{result.reason === 'too_far' ? 'No suitable nearby station' : 'No current station reading'}</span>
                      )}
                    </div>
                    {result.status === 'available' && (
                      <p className={`station-time${isStaleReading(result.timestamp) ? ' is-stale' : ''}`}>
                        {isStaleReading(result.timestamp) && <strong>STALE · </strong>}
                        Measured {formatMalaysiaTime(result.timestamp)} MYT
                      </p>
                    )}
                    <button type="button" className="card-detail-link" onClick={() => setSelectedCity(city.name)}>
                      View station details <span aria-hidden="true">↗</span>
                    </button>
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="empty-state">
              <span aria-hidden="true">{favoritesOnly ? '☆' : '⌕'}</span>
              <h3>{favoritesOnly && favoriteState.cities.length === 0 ? 'No favorites yet' : 'No matching cities'}</h3>
              <p>{favoritesOnly && favoriteState.cities.length === 0
                ? 'Save a city with the star on its card and it will be easy to find here.'
                : 'Try another city or state, or clear your filters.'}</p>
              <button type="button" className="text-button" onClick={() => { setSearch(''); setFavoritesOnly(false) }}>Show all cities</button>
            </div>
          )}

          <p className="measurement-note">Malaysia API/IPU is an index, not a pollutant concentration. Cards show the official station and its approximate distance from the named city.</p>
        </section>

        {selectedReading && (
          <section id="city-details" aria-labelledby="detail-title" className="details-panel">
            <div className="detail-heading">
              <div>
                <p className="eyebrow section-eyebrow">A CLOSER LOOK</p>
                <h2 id="detail-title">{selectedReading.city.name}<span>, {selectedReading.city.state}</span></h2>
                <p className="section-subtitle">Official station reading, Malaysian API/IPU category, and hourly station history.</p>
              </div>
              <label className="focus-control">
                <span>Viewing</span>
                <select aria-label="Choose a default city for detailed readings" value={selectedCity} onChange={(event) => setSelectedCity(event.target.value)}>
                  {cities.map((city) => <option key={city.name} value={city.name}>{city.name}</option>)}
                </select>
              </label>
            </div>

            {selectedReading.result.status === 'available' ? (
              <>
                <div className="pollutant-grid">
                  <div className="pollutant-item">
                    <span>Malaysia API/IPU</span>
                    <strong>{selectedReading.result.index} <small>index</small></strong>
                  </div>
                  <div className="pollutant-item">
                    <span>Category</span>
                    <strong>{getAqiCategory(selectedReading.result.index ?? 0, selectedReading.result.category).label}</strong>
                  </div>
                  <div className="pollutant-item">
                    <span>Dominant pollutant</span>
                    <strong>{selectedReading.result.dominantPollutant || 'Not reported'}</strong>
                  </div>
                  <div className="pollutant-item">
                    <span>Station distance</span>
                    <strong>{formatMeasurement(selectedReading.result.station?.distanceKm)} <small>km</small></strong>
                  </div>
                  <div className="pollutant-item">
                    <span>Measurement time</span>
                    <strong>
                      {isStaleReading(selectedReading.result.timestamp) && <small className="stale-label">STALE · </small>}
                      {formatMalaysiaTime(selectedReading.result.timestamp, { dateStyle: 'medium' })} · {formatMalaysiaTime(selectedReading.result.timestamp)} <small>MYT</small>
                    </strong>
                  </div>
                  <div className="pollutant-item">
                    <span>Station</span>
                    <strong>{selectedReading.result.station?.name || 'Not reported'}</strong>
                  </div>
                </div>
                <p className="detail-source">Source: {selectedReading.result.source} · Malaysia Air Pollutant Index (API/IPU). The API/IPU is not the US AQI.</p>

                <div className="health-advice">
                  <span className="advice-icon" aria-hidden="true">✳</span>
                  <div>
                    <h3>Health guidance <span>· {getAqiCategory(selectedReading.result.index ?? 0, selectedReading.result.category).label}</span></h3>
                    <p>{getAqiCategory(selectedReading.result.index ?? 0, selectedReading.result.category).advice}</p>
                  </div>
                </div>

                <div className="forecast-section">
                  <div className="forecast-heading">
                    <div>
                      <h3>Hourly Malaysia API/IPU history</h3>
                      <p>Published station readings over the previous 24 hours · index values</p>
                    </div>
                    <span className="forecast-key"><i aria-hidden="true" /> API/IPU</span>
                  </div>
                  <IpuTrend
                    stationId={selectedReading.result.station?.id ?? ''}
                    timestamp={selectedReading.result.timestamp ?? ''}
                    refreshKey={lastUpdated?.getTime() ?? 0}
                  />
                </div>
              </>
            ) : (
              <div className="search-reading-state is-unavailable" role={selectedReading.result.status === 'error' ? 'alert' : 'status'}>
                {selectedReading.result.status === 'loading'
                  ? 'Checking official station readings…'
                  : selectedReading.result.status === 'error'
                    ? selectedReading.result.message || 'The official monitoring service could not provide this reading.'
                    : selectedReading.result.reason === 'too_far'
                      ? `No suitable station is within 100 km. The nearest reported station is approximately ${formatMeasurement(selectedReading.result.station?.distanceKm)} km away.`
                      : selectedReading.result.reason === 'no_station'
                        ? 'The official monitoring service returned no station for this city.'
                        : 'No current reading is available from the nearest station.'}
                {selectedReading.result.station && <p>Nearest station: {selectedReading.result.station.name}. No reading is being presented as a city measurement.</p>}
              </div>
            )}
          </section>
        )}

        <footer className="site-footer">
          <p>Air-quality data: <a href="https://eqms.doe.gov.my/" target="_blank" rel="noreferrer">Malaysia DOE MyEQMS / APIMS</a>.</p>
          <p>Place search: GeoNames, licensed under CC BY 4.0. Measurements are published station readings, not continuous city-wide sensing or medical advice.</p>
        </footer>
      </main>
    </div>
  )
}

export default App
