// Builds the browser extension into extension/dist/chrome and extension/dist/firefox.
// Load the folder unpacked: chrome://extensions (Developer mode) or about:debugging in Firefox.
import { build } from 'esbuild'
import { cp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { join } from 'path'

const root = fileURLToPath(new URL('..', import.meta.url))
const ext = join(root, 'extension')
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

// Pins the Chrome extension ID (CHROME_EXTENSION_ID in src/shared/browser-protocol.ts) so the
// native messaging host can allow it however the extension is installed
const CHROME_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvwbdICwImD6UMSspa8CGZ2A8kFPuvqhnPQSSLH0hFVCrsIUD8aaaTiCrqvsosIVh41zvknSZwmoqwjizFqukQCSIRl/XZXo7OiIQq1dN/44ukOvxK9lJnwg84NwegT31PB3IcKmwKIG8uenW63cYuimL06JbfJ+QmJc1dGpm+z9ZErwe4tIVxd7CyKtyHI7zUv70V4xskmN9084gNl7x0sHiiyxxVe2FkabOwBztHPApzjSihVuQREDnJNGwc6tqrHcbFAfGt0YnQGNoFF1mn3CkSLIqgF2NmatZ9ZNcJ5OHrIII88WQsFBU7fCbP9Moly35rJA1SrbxQfekq6McMQIDAQAB'

const base = {
  manifest_version: 3,
  name: 'Password Manager',
  version,
  description: 'Fill logins and forms from the Password Manager desktop app.',
  icons: {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png'
  },
  host_permissions: ['<all_urls>'],
  content_scripts: [
    { matches: ['<all_urls>'], js: ['content.js'], all_frames: true, run_at: 'document_start' }
  ]
}

const targets = {
  chrome: {
    ...base,
    key: CHROME_KEY,
    minimum_chrome_version: '116',
    permissions: ['contextMenus', 'nativeMessaging', 'storage'],
    background: { service_worker: 'background.js' }
  },
  firefox: {
    ...base,
    // "menus" adds onShown/refresh, so the menu can match the frame that was right-clicked
    permissions: ['menus', 'nativeMessaging', 'storage'],
    background: { scripts: ['background.js'] },
    browser_specific_settings: {
      gecko: {
        id: 'password-manager@asofianidis',
        strict_min_version: '128.0',
        // Firefox checks this for new signed versions (EXTENSION_CHANNEL_URL in browser-protocol.ts)
        update_url:
          'https://github.com/asofianidis/password-manager/releases/download/extension-latest/updates.json',
        // Logins go only to the local desktop app; nothing is sent anywhere else
        data_collection_permissions: { required: ['none'] }
      }
    }
  }
}

for (const [name, manifest] of Object.entries(targets)) {
  const outdir = join(ext, 'dist', name)
  await rm(outdir, { recursive: true, force: true })
  await mkdir(outdir, { recursive: true })
  await build({
    entryPoints: [join(ext, 'src', 'background.ts'), join(ext, 'src', 'content.ts')],
    outdir,
    bundle: true,
    format: 'iife',
    target: name === 'chrome' ? 'chrome116' : 'firefox128',
    logLevel: 'warning'
  })
  await cp(join(ext, 'icons'), join(outdir, 'icons'), { recursive: true })
  await writeFile(join(outdir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`Built ${name} extension in ${outdir}`)
}
