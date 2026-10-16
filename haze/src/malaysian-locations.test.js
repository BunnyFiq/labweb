import test from 'node:test'
import assert from 'node:assert/strict'
import gazetteer from './data/malaysian-settlements.json' with { type: 'json' }
import { searchMalaysianLocations } from './malaysian-locations.js'

test('gazetteer covers all Malaysian states and federal territories', () => {
  const states = new Set(gazetteer.records.map(([, state]) => state))
  assert.equal(states.size, 16)
  assert.ok(gazetteer.records.length > 20_000)
})

test('city search distinguishes similarly named locations by state', () => {
  const results = searchMalaysianLocations('Kuala Lumpur')
  assert.ok(results.length > 0)
  assert.equal(results[0].name, 'Kuala Lumpur')
  assert.equal(results[0].state, 'Federal Territory of Kuala Lumpur')
  assert.ok(results.every((location) => location.state))
})

test('city search includes smaller settlements and respects the suggestion limit', () => {
  const results = searchMalaysianLocations('Bario', 8)
  assert.ok(results.some((location) => location.name === 'Bario' && location.state === 'Sarawak'))
  assert.ok(results.length <= 8)
  assert.equal(searchMalaysianLocations('Ba').length, 0)

  const capital = searchMalaysianLocations('Putrajaya')
  assert.ok(capital.some((location) => location.state === 'Federal Territory of Putrajaya'))

  const southernSettlement = searchMalaysianLocations('Kampong Diri')
  assert.ok(southernSettlement.some((location) => location.latitude < 0.7 && location.state === 'Sarawak'))
})

test('search records contain valid Malaysian coordinates and named divisions', () => {
  for (const [name, state, latitude, longitude] of gazetteer.records) {
    assert.ok(name)
    assert.ok(state)
    assert.ok(latitude >= -0.7 && latitude <= 7.5)
    assert.ok(longitude >= 99.5 && longitude <= 120)
  }
})
