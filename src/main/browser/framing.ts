/**
 * Native messaging frames: a 32-bit length in native byte order (little-endian on every platform
 * browsers support), then that many bytes of UTF-8 JSON.
 */

/** Browsers cap messages to the host at 4 GB and from it at 1 MB; nothing here comes close */
const MAX_FRAME = 4 * 1024 * 1024

export function encodeFrame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  const header = Buffer.alloc(4)
  header.writeUInt32LE(body.length, 0)
  return Buffer.concat([header, body])
}

export class FrameDecoder {
  private buffer = Buffer.alloc(0)

  /** Returns every complete message in the data seen so far. */
  push(chunk: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const messages: unknown[] = []
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0)
      if (length > MAX_FRAME) throw new Error(`Frame too large: ${length} bytes`)
      if (this.buffer.length < 4 + length) break
      messages.push(JSON.parse(this.buffer.subarray(4, 4 + length).toString('utf8')))
      this.buffer = this.buffer.subarray(4 + length)
    }
    return messages
  }
}

/** Newline-delimited JSON, used between the native host and the app. */
export class LineDecoder {
  private buffer = ''

  push(chunk: Buffer | string): unknown[] {
    this.buffer += chunk.toString()
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''
    if (this.buffer.length > MAX_FRAME) throw new Error('Line too long')
    return lines.filter((line) => line.trim()).map((line) => JSON.parse(line))
  }
}

export const encodeLine = (message: unknown): string => `${JSON.stringify(message)}\n`
