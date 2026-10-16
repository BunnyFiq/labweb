import gazetteer from './data/malaysian-settlements.json' with { type: 'json' }

function normalize(value) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase().trim().replace(/\s+/g, ' ')
}

const records = gazetteer.records.map(([name, state, latitude, longitude, asciiName], index) => ({
  id: String(index),
  name,
  state,
  latitude,
  longitude,
  normalizedName: normalize(name),
  normalizedAsciiName: normalize(asciiName ?? name),
  normalizedState: normalize(state),
}))

export function searchMalaysianLocations(query, limit = 8) {
  const normalizedQuery = normalize(query)
  if (normalizedQuery.length < 3) return []

  return records.flatMap((location) => {
    const rank = location.normalizedName === normalizedQuery || location.normalizedAsciiName === normalizedQuery
      ? 0
      : location.normalizedName.startsWith(normalizedQuery) || location.normalizedAsciiName.startsWith(normalizedQuery)
        ? 1
        : `${location.normalizedName} ${location.normalizedAsciiName} ${location.normalizedState}`.includes(normalizedQuery)
          ? 2
          : -1
    if (rank < 0) return []
    return [{
      id: location.id,
      name: location.name,
      state: location.state,
      latitude: location.latitude,
      longitude: location.longitude,
      rank,
    }]
  })
    .sort((first, second) => first.rank - second.rank
      || first.name.localeCompare(second.name)
      || first.state.localeCompare(second.state))
    .slice(0, limit)
    .map((location) => ({
      id: location.id,
      name: location.name,
      state: location.state,
      latitude: location.latitude,
      longitude: location.longitude,
    }))
}
