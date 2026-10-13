import { describe, expect, it } from 'vitest'
import { parseCsv, stringifyCsv } from '../src/shared/csv'

describe('csv', () => {
  it('parses quoted fields, escaped quotes, and embedded newlines', () => {
    const text = '﻿a,b,c\r\n"x, y","he said ""hi""","line1\nline2"\n'
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'he said "hi"', 'line1\nline2']
    ])
  })

  it('round-trips through stringify', () => {
    const rows = [
      ['title', 'password'],
      ['a,b', 'p"w\nx']
    ]
    expect(parseCsv(stringifyCsv(rows))).toEqual(rows)
  })

  it('skips blank lines', () => {
    expect(parseCsv('a,b\n\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })
})
