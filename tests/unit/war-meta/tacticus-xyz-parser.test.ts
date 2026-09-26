import { describe, expect, it } from 'vitest'
import {
  discoverTacticusXyzWarMetaDimensions,
  parseTacticusXyzCoresPage,
  parseTacticusXyzLineupsPage
} from '@/app/lib/war-meta/tacticus-xyz-parser'

const known = new Set(['a', 'b', 'c', 'd', 'e', 'f'])

describe('tacticus.xyz Guild War aggregate parser', () => {
  it('discovers seasons and battlefield levels', () => {
    const html = `
      <input name="season[]" value="26"><input name="season[]" value="25">
      <input name="battlefield[]" value="1"><input name="battlefield[]" value="5">
    `
    expect(discoverTacticusXyzWarMetaDimensions(html)).toEqual({
      seasons: [26, 25],
      battlefieldLevels: [1, 5]
    })
  })

  it('parses a lineup row and pagination', () => {
    const html = `
      <table><tbody><tr class="hover:bg-gray-50 flex-nowrap">
        <td>${['e', 'a', 'd', 'b', 'c'].map((id) => `<img alt="${id}">`).join('')}</td>
        <td>1,000</td><td>750</td><td>250</td><td>75.0%</td><td>1234.5</td><td>1300</td>
      </tr></tbody></table>
      <a href="?battlefield%5B%5D=5&amp;page=2">Next →</a><a href="?page=7">7</a>
      Showing <span>1</span>–<span>20</span> of <span>123</span> total entries
    `
    expect(parseTacticusXyzLineupsPage(html, known)).toMatchObject({
      totalPages: 7,
      totalEntries: 123,
      rows: [
        {
          lineup_key: 'a|b|c|d|e',
          uses: 1000,
          wins: 750,
          losses: 250,
          win_rate: 75,
          avg_score: 1234.5
        }
      ]
    })
  })

  it('parses a single-page lineup table without a total entries footer', () => {
    const html = `
      <table><thead><tr><th>Attacking Team</th><th>Used</th><th>Wins</th><th>Losses</th></tr></thead>
      <tbody><tr class="hover:bg-gray-50 flex-nowrap">
        <td>${['a', 'b', 'c', 'd', 'e'].map((id) => `<img alt="${id}">`).join('')}</td>
        <td>11</td><td>8</td><td>3</td><td>72.7%</td><td>1100</td><td>1200</td>
      </tr></tbody></table>
    `
    expect(parseTacticusXyzLineupsPage(html, known)).toMatchObject({
      page: 1,
      totalPages: 1,
      totalEntries: 1,
      rows: [{ lineup_key: 'a|b|c|d|e', uses: 11, wins: 8, losses: 3 }]
    })
  })

  it('rejects a response truncated after otherwise valid lineup rows', () => {
    const html = `
      <table><thead><tr><th>Attacking Team</th><th>Used</th></tr></thead>
      <tbody><tr class="flex-nowrap">
        <td>${['a', 'b', 'c', 'd', 'e'].map((id) => `<img alt="${id}">`).join('')}</td>
        <td>11</td><td>8</td><td>3</td><td>72.7%</td><td>1100</td><td>1200</td>
      </tr>
    `
    expect(() => parseTacticusXyzLineupsPage(html, known)).toThrow(
      'tacticus.xyz lineup page shape is not recognized'
    )
  })

  it('parses complete empty lineup variants', () => {
    const emptyTable = `
      <html><body><table><thead><tr><th>Attacking Team</th></tr></thead><tbody></tbody></table></body></html>
    `
    expect(parseTacticusXyzLineupsPage(emptyTable, known).rows).toEqual([])

    const explicitEmpty = `
      <html><body><p>No lineup data available for these filters yet.</p></body></html>
    `
    expect(parseTacticusXyzLineupsPage(explicitEmpty, known).rows).toEqual([])
  })

  it('rejects rows with an unrecognized lineup row class', () => {
    const html = `
      <html><body><table><thead><tr><th>Attacking Team</th></tr></thead>
      <tbody><tr class="changed-row-class"><td>unexpected row</td></tr></tbody>
      </table></body></html>
    `
    expect(() => parseTacticusXyzLineupsPage(html, known)).toThrow(
      'tacticus.xyz lineup page shape is not recognized'
    )
  })

  it('parses a trio and flex counts', () => {
    const html = `
      <tr data-core-key="c|a|b"><td>icons</td><td>flex</td><td>100</td><td>60</td><td>60.0%</td></tr>
      <tr id="core-details-a|b|c"><td>
        <img alt="d"> Used <span>40</span> Wins <span>30</span> Win <span>75.0%</span>
      </td></tr>
    `
    expect(parseTacticusXyzCoresPage(html, 'offense', known).rows).toEqual([
      {
        core_key: 'a|b|c',
        unit_ids: ['a', 'b', 'c'],
        uses: 100,
        wins: 60,
        win_rate: 60,
        flex_options: [{ heroKey: 'd', uses: 40, wins: 30, winRate: 75 }]
      }
    ])
  })

  it('parses the complete core-3 empty state', () => {
    const html = `
      <html><body><section><p>No core-3 data available yet.</p></section></body></html>
    `
    expect(parseTacticusXyzCoresPage(html, 'offense', known)).toEqual({
      page: 1,
      totalPages: 1,
      totalEntries: 0,
      rows: [],
      quarantinedRows: []
    })

    const defenseHtml = `
      <html><body><p>No defensive core-3 data available yet.</p></body></html>
    `
    expect(
      parseTacticusXyzCoresPage(defenseHtml, 'defense', known).rows
    ).toEqual([])
  })

  it('rejects a truncated core-3 empty state', () => {
    expect(() =>
      parseTacticusXyzCoresPage(
        '<html><body>No core-3 data available yet.',
        'offense',
        known
      )
    ).toThrow('tacticus.xyz core page shape is not recognized')
  })

  it('quarantines unknown units without importing the row', () => {
    const html = `
      <table><tbody><tr class="flex-nowrap">
        <td><img alt="a"><img alt="b"><img alt="c"><img alt="d"><img alt="newHero"></td>
        <td>10</td><td>5</td><td>5</td><td>50%</td><td>900</td><td>950</td>
      </tr></tbody></table>
      Showing <span>1</span>–<span>1</span> of <span>1</span> total entries
    `
    const parsed = parseTacticusXyzLineupsPage(html, known)
    expect(parsed.rows).toEqual([])
    expect(parsed.quarantinedRows[0]?.unknown_unit_ids).toEqual(['newHero'])
  })

  it('rejects malformed count relationships', () => {
    const html = `
      <table><tbody><tr class="flex-nowrap">
        <td><img alt="a"><img alt="b"><img alt="c"><img alt="d"><img alt="e"></td>
        <td>10</td><td>9</td><td>9</td><td>90%</td><td>900</td><td>950</td>
      </tr></tbody></table>
      Showing <span>1</span>–<span>1</span> of <span>1</span> total entries
    `
    expect(() => parseTacticusXyzLineupsPage(html, known)).toThrow(
      'Invalid counts'
    )
  })
})
