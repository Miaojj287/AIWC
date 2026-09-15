import { expect, it } from 'vitest'
import { wxgfPartitions } from './convertWxgf'
it('extracts length-delimited partitions without including container metadata', () => {
  const header = Buffer.alloc(20)
  header.write('wxgf')
  header[4] = 20
  const first = Buffer.from([0, 0, 0, 1, 64, 1, 2, 3])
  const second = Buffer.from([0, 0, 0, 1, 2, 1, 4, 5])
  const wrap = (part: Buffer) => {
    const size = Buffer.alloc(4)
    size.writeUInt32BE(part.length)
    return Buffer.concat([size, part])
  }
  expect(wxgfPartitions(Buffer.concat([header, wrap(first), Buffer.from([255, 255]), wrap(second)]))).toEqual([
    first,
    second,
  ])
  expect(wxgfPartitions(Buffer.from('wxgf'))).toEqual([])
  expect(wxgfPartitions(Buffer.concat([header, Buffer.from([255, 255, 255, 255]), first]))).toEqual([])
})
