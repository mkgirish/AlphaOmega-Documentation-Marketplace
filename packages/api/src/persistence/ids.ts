// Row ids for registrations. They are generated here rather than by the database so that
// they sort by insertion order, and they never leave the process in a response.
import { randomBytes } from 'node:crypto'

// The last id's timestamp and sequence as one number: milliseconds × 4096 + sequence.
let last = 0n

/**
 * A UUIDv7 (RFC 9562): 48 bits of Unix milliseconds, then a 12-bit sequence that keeps ids
 * from one process strictly increasing within a millisecond. created_at is whole seconds,
 * so rows inserted in the same second still sort newest-last by id.
 */
export function uuidV7(now: number = Date.now()): string {
  const stamp = BigInt(now) * 4096n
  last = stamp > last ? stamp : last + 1n
  const bytes = randomBytes(16)
  bytes.writeUIntBE(Number(last / 4096n), 0, 6)
  bytes.writeUInt16BE(0x7000 | Number(last % 4096n), 6)
  bytes.writeUInt8(0x80 | (bytes.readUInt8(8) & 0x3f), 8)
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
