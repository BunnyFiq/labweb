import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'

type City = {
  name: string
  state: string
  latitude: number
  longitude: number
}

type AirQualityResponse = {
  current: {
    time: string
    us_aqi: number | null
    pm2_5: number | null
    pm10: number | null
    ozone: number | null
    nitrogen_dioxide: number | null
    sulphur_dioxide: number | null
    carbon_monoxide: number | null
  }
  hourly: {
    time: string[]
    pm2_5: Array<number | null>
  }
}

type CityReading = {
  city: City
  current: AirQualityResponse['current']
  hourly: AirQualityResponse['hourly']
}

type AqiCategory = {
  label: string
  badgeClass: string
  backgroundClass: string
  advice: string
}

const cities: City[] = [
  { name: 'Kota Bharu', state: 'Kelantan', latitude: 6.1256, longitude: 102.2381 },
  { name: 'Kuala Lumpur', state: 'Kuala Lumpur', latitude: 3.139, longitude: 101.6869 },
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

function getAqiCategory(aqi: number): AqiCategory {
  if (aqi <= 50) {
    return {
      label: 'Good',
      badgeClass: 'badge-success',
      backgroundClass: 'haze-good',
      advice: 'Air quality is good. Enjoy your usual outdoor activities.',
    }
  }
  if (aqi <= 100) {
    return {
      label: 'Moderate',
      badgeClass: 'badge-warning',
      backgroundClass: 'haze-moderate',
      advice: 'Air quality is acceptable. Sensitive people may wish to limit prolonged outdoor activity.',
    }
  }
  if (aqi <= 150) {
    return {
      label: 'Unhealthy for Sensitive Groups',
      badgeClass: 'badge-unhealthy-sensitive',
      backgroundClass: 'haze-sensitive',
      advice: 'Sensitive groups should reduce prolonged or heavy outdoor activity and keep inhalers nearby.',
    }
  }
  if (aqi <= 200) {
    return {
      label: 'Unhealthy',
      badgeClass: 'badge-error',
      backgroundClass: 'haze-unhealthy',
      advice: 'Wear a well-fitted N95 mask outdoors and limit outdoor activity, especially strenuous exercise.',
    }
  }
  if (aqi <= 300) {
    return {
      label: 'Very Unhealthy',
      badgeClass: 'badge-secondary',
      backgroundClass: 'haze-very-unhealthy',
      advice: 'Avoid outdoor activity, stay indoors with windows closed, and use an air purifier if available.',
    }
  }
  return {
    label: 'Hazardous',
    badgeClass: 'badge-hazardous',
    backgroundClass: 'haze-hazardous',
    advice: 'Stay indoors, keep windows and doors closed, and avoid all outdoor physical activity.',
  }
}

function formatMeasurement(value: number | null): string {
  return value === null ? '—' : value.toFixed(1)
}

async function fetchCityReading(city: City): Promise<CityReading> {
  const params = new URLSearchParams({
    latitude: String(city.latitude),
    longitude: String(city.longitude),
    current: 'us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide',
    hourly: 'pm2_5',
    forecast_days: '2',
    timezone: 'auto',
  })
  const response = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`)
  if (!response.ok) {
    throw new Error(`Could not load ${city.name} (${response.status})`)
  }
  const data: AirQualityResponse = await response.json()
  if (!data.current || !data.hourly || !Array.isArray(data.hourly.time) || !Array.isArray(data.hourly.pm2_5)) {
    throw new Error(`The air-quality response for ${city.name} was incomplete`)
  }
  if (data.current.us_aqi == null) {
    throw new Error(`AQI is not available for ${city.name}`)
  }
  return { city, current: data.current, hourly: data.hourly }
}

function App() {
  const [readings, setReadings] = useState<CityReading[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [selectedCity, setSelectedCity] = useState('all')
  const [sortOrder, setSortOrder] = useState<'aqi' | 'alphabetical'>('aqi')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  const loadReadings = useCallback(async () => {
    try {
      const results = await Promise.all(cities.map(fetchCityReading))
      setReadings(results)
      setLastUpdated(new Date())
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Air quality data could not be loaded.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    const initialFetch = window.setTimeout(() => void loadReadings(), 0)
    const interval = window.setInterval(() => void loadReadings(), 10 * 60 * 1000)
    return () => {
      window.clearTimeout(initialFetch)
      window.clearInterval(interval)
    }
  }, [loadReadings])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const sortedReadings = useMemo(() => {
    const visibleReadings = selectedCity === 'all'
      ? [...readings]
      : readings.filter((reading) => reading.city.name === selectedCity)
    return visibleReadings.sort((first, second) => {
      if (sortOrder === 'alphabetical') return first.city.name.localeCompare(second.city.name)
      return (second.current.us_aqi ?? 0) - (first.current.us_aqi ?? 0)
    })
  }, [readings, selectedCity, sortOrder])

  const selectedReading = readings.find((reading) => reading.city.name === selectedCity)
  const worstAqi = readings.reduce((highest, reading) => Math.max(highest, reading.current.us_aqi ?? 0), 0)
  const backgroundClass = getAqiCategory(worstAqi).backgroundClass
  const affectedCities = readings.filter((reading) => (reading.current.us_aqi ?? 0) > 100)

  return (
    <div className={`min-h-screen haze-background ${backgroundClass}`}>
      <header className="navbar border-b border-base-300 bg-base-100/85 px-4 py-3 shadow-sm backdrop-blur sm:px-8">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Malaysia · Air quality</p>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Malaysia Haze Monitor</h1>
            <p className="text-sm text-base-content/70">A live look at the air across 12 Malaysian cities.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            >
              {theme === 'light' ? '☾ Dark' : '☀ Light'}
            </button>
            <div className="text-right text-xs text-base-content/70" aria-live="polite">
              <div>Last updated</div>
              <time>{lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</time>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setError('')
                setRefreshing(true)
                void loadReadings()
              }}
              disabled={refreshing}
            >
              {refreshing && <span className="loading loading-spinner loading-xs" aria-hidden="true" />}
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-8 sm:py-10">
        {affectedCities.length > 0 && (
          <div role="alert" className="alert alert-warning shadow-sm">
            <span className="text-xl" aria-hidden="true">⚠</span>
            <div>
              <h2 className="font-bold">Haze alert: elevated AQI detected</h2>
              <p className="text-sm">
                AQI is above 100 in {affectedCities.map((reading) => reading.city.name).join(', ')}.
                Consider limiting prolonged outdoor activity.
              </p>
            </div>
          </div>
        )}

        {error && (
          <div role="alert" className="alert alert-error">
            <span>{readings.length > 0 ? `Refresh failed: ${error}` : `Unable to load air-quality data: ${error}`}</span>
            <button type="button" className="btn btn-sm" onClick={() => void loadReadings()} disabled={refreshing}>
              Retry
            </button>
          </div>
        )}

        <section aria-labelledby="overview-title" className="space-y-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <h2 id="overview-title" className="text-xl font-bold">City overview</h2>
              <p className="text-sm text-base-content/70">US AQI and particulate readings in micrograms per cubic metre.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <label className="form-control">
                <span className="label-text mb-1 text-xs font-semibold">View</span>
                <select
                  className="select select-bordered select-sm min-w-48"
                  aria-label="Select a city or view all cities"
                  value={selectedCity}
                  onChange={(event) => setSelectedCity(event.target.value)}
                >
                  <option value="all">All cities</option>
                  {cities.map((city) => <option key={city.name} value={city.name}>{city.name} · {city.state}</option>)}
                </select>
              </label>
              <label className="form-control">
                <span className="label-text mb-1 text-xs font-semibold">Sort by</span>
                <select
                  className="select select-bordered select-sm min-w-44"
                  aria-label="Sort cities"
                  value={sortOrder}
                  onChange={(event) => setSortOrder(event.target.value as 'aqi' | 'alphabetical')}
                >
                  <option value="aqi">Worst AQI first</option>
                  <option value="alphabetical">Alphabetical</option>
                </select>
              </label>
            </div>
          </div>

          {loading && readings.length === 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="Loading city air quality">
              {cities.slice(0, 8).map((city) => (
                <div className="card border border-base-300 bg-base-100 shadow-sm" key={city.name}>
                  <div className="card-body gap-3">
                    <div className="skeleton h-5 w-2/3" />
                    <div className="skeleton h-10 w-1/3" />
                    <div className="skeleton h-5 w-1/2" />
                    <div className="skeleton h-4 w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : readings.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {sortedReadings.map((reading) => {
                const aqi = reading.current.us_aqi ?? 0
                const category = getAqiCategory(aqi)
                return (
                  <button
                    type="button"
                    key={reading.city.name}
                    className="card border border-base-300 bg-base-100 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary"
                    aria-label={`View details for ${reading.city.name}, AQI ${aqi}, ${category.label}`}
                    onClick={() => setSelectedCity(reading.city.name)}
                  >
                    <div className="card-body gap-3 p-5">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="card-title text-base">{reading.city.name}</h3>
                          <p className="text-xs text-base-content/60">{reading.city.state}</p>
                        </div>
                        <span className={`badge ${category.badgeClass}`}>{category.label}</span>
                      </div>
                      <div className="stat p-0">
                        <div className="stat-title text-xs">US AQI</div>
                        <div className="stat-value text-4xl">{aqi}</div>
                      </div>
                      <div className="flex justify-between border-t border-base-200 pt-3 text-sm">
                        <span>PM2.5 <strong>{formatMeasurement(reading.current.pm2_5)}</strong> µg/m³</span>
                        <span>PM10 <strong>{formatMeasurement(reading.current.pm10)}</strong> µg/m³</span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          ) : !loading && !error ? (
            <p className="rounded-box bg-base-100 p-6 text-center text-base-content/70">No city readings are available yet.</p>
          ) : null}
        </section>

        {selectedReading && (
          <section aria-labelledby="detail-title" className="card border border-base-300 bg-base-100 shadow-sm">
            <div className="card-body">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-primary">City details</p>
                  <h2 id="detail-title" className="card-title text-2xl">{selectedReading.city.name}, {selectedReading.city.state}</h2>
                </div>
                <span className={`badge badge-lg ${getAqiCategory(selectedReading.current.us_aqi ?? 0).badgeClass}`}>
                  AQI {selectedReading.current.us_aqi} · {getAqiCategory(selectedReading.current.us_aqi ?? 0).label}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {([
                  ['PM2.5', selectedReading.current.pm2_5],
                  ['PM10', selectedReading.current.pm10],
                  ['Ozone', selectedReading.current.ozone],
                  ['Nitrogen dioxide', selectedReading.current.nitrogen_dioxide],
                  ['Sulphur dioxide', selectedReading.current.sulphur_dioxide],
                  ['Carbon monoxide', selectedReading.current.carbon_monoxide],
                ] as Array<[string, number | null]>).map(([name, value]) => (
                  <div className="rounded-box bg-base-200/70 p-3" key={name}>
                    <p className="text-xs text-base-content/70">{name}</p>
                    <p className="text-lg font-bold">{formatMeasurement(value)} <span className="text-xs font-normal">µg/m³</span></p>
                  </div>
                ))}
              </div>

              <div className="alert mt-2">
                <span aria-hidden="true">♥</span>
                <div>
                  <h3 className="font-bold">Health advice · {getAqiCategory(selectedReading.current.us_aqi ?? 0).label}</h3>
                  <p className="text-sm">{getAqiCategory(selectedReading.current.us_aqi ?? 0).advice}</p>
                </div>
              </div>

              <div className="mt-2">
                <h3 className="font-bold">Hourly PM2.5 forecast</h3>
                <p className="mb-3 text-xs text-base-content/70">Next 24 hours · µg/m³ · bars show relative concentration</p>
                <PmTrend reading={selectedReading} />
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="mt-auto border-t border-base-300 bg-base-100/80 px-4 py-5 text-center text-xs text-base-content/70">
        <p>Air-quality data: <a className="link" href="https://open-meteo.com/en/docs/air-quality-api" target="_blank" rel="noreferrer">Open-Meteo Air Quality API</a>.</p>
        <p className="mt-1">This is an informational estimate, not an official Malaysian DOE API reading.</p>
      </footer>
    </div>
  )
}

function PmTrend({ reading }: { reading: CityReading }) {
  const currentHour = reading.current.time
  const start = reading.hourly.time.findIndex((time) => time > currentHour)
  const startIndex = start < 0 ? reading.hourly.time.length : start
  const points = reading.hourly.time.slice(startIndex, startIndex + 24).map((time, index) => ({
    time,
    value: reading.hourly.pm2_5[startIndex + index] ?? null,
  }))
  const max = Math.max(...points.map((point) => point.value ?? 0), 1)

  if (points.length === 0) {
    return <p className="text-sm text-base-content/70">Hourly forecast is not available.</p>
  }

  return (
    <div className="overflow-x-auto rounded-box bg-base-200/50 p-4">
      <div className="flex h-36 min-w-[36rem] items-end gap-1" role="img" aria-label={`Hourly PM2.5 forecast for ${reading.city.name}`}>
        {points.map((point) => {
          const height = point.value === null ? 0 : Math.max((point.value / max) * 100, 3)
          return (
            <div className="flex h-full flex-1 flex-col items-center justify-end gap-1" key={point.time}>
              <span className="text-[10px] text-base-content/70">{formatMeasurement(point.value)}</span>
              <div
                className="w-full rounded-t bg-primary/80"
                style={{ height: `${height}%` }}
                title={`${point.time.replace('T', ' ')} · ${formatMeasurement(point.value)} µg/m³`}
              />
              <span className="text-[9px] text-base-content/60">{point.time.slice(11, 16)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default App
