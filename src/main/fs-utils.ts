import { promises as fs } from 'fs'
import { dirname } from 'path'

/** Writes via a temp file + rename so a crash mid-write never leaves a truncated file. */
export async function writeFileAtomic(path: string, contents: string | Buffer): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  const handle = await fs.open(tmp, 'w', 0o600)
  try {
    await handle.writeFile(contents)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fs.rename(tmp, path)
}

export async function readFileIfExists(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
