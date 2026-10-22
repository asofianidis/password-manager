// Packs the built extension (run build:extension first) into release zips in extension/release.
// Chrome only installs .crx files from the Chrome Web Store, so the Chromium build ships as a zip
// that the desktop app unpacks into the folder the browser loads it from.
import { execFileSync } from 'child_process'
import { mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'extension', 'dist')
const out = join(root, 'extension', 'release')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
for (const target of ['chrome', 'firefox']) {
  const file = join(out, `password-manager-extension-${version}-${target}.zip`)
  execFileSync('zip', ['-qr', file, '.'], { cwd: join(dist, target) })
  console.log(`Packed ${file}`)
}
