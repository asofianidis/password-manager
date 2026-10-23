import {
  compareVersions,
  type BridgeFillable,
  type BridgeLogin
} from '../../src/shared/browser-protocol'
import { NativeClient, ext, type ClientError } from './native'
import type { FillFieldsMessage, FillMessage } from './content'

const ROOT = 'pm'
const PAIR_TIMEOUT_MS = 2 * 60 * 1000
const TOKEN_KEY = 'token'
const RELOADED_FOR_KEY = 'reloadedFor'

/** Firefox-only API; also how we tell the browsers apart */
const getBrowserInfo = (ext.runtime as { getBrowserInfo?: () => Promise<{ name: string }> })
  .getBrowserInfo

const client = new NativeClient(() => void refreshActiveTab())

/**
 * Firefox only exposes contextMenus with the "contextMenus" permission; we request "menus" there,
 * which adds onShown/refresh so the menu can match the frame that was right-clicked
 */
type MenusApi = typeof chrome.contextMenus & {
  onShown?: { addListener(fn: (info: { frameUrl?: string; pageUrl?: string }) => void): void }
  refresh?: () => Promise<void>
}
const menus: MenusApi = (ext as { menus?: MenusApi }).menus ?? ext.contextMenus

async function getToken(): Promise<string | null> {
  const stored = await ext.storage.local.get(TOKEN_KEY)
  return typeof stored[TOKEN_KEY] === 'string' ? (stored[TOKEN_KEY] as string) : null
}

const setToken = (token: string | null): Promise<void> =>
  token ? ext.storage.local.set({ [TOKEN_KEY]: token }) : ext.storage.local.remove(TOKEN_KEY)

type MenuItem =
  { id: string; title: string; enabled?: boolean; children?: MenuItem[] } | { separator: true }

const isWebPage = (url: string | undefined): url is string => /^https?:\/\//.test(url ?? '')

const hostOf = (url: string): string => new URL(url).hostname.replace(/^www\./, '')

/** Menu titles treat & as an access key marker */
const label = (text: string): string => text.replace(/&/g, '&&')

function loginTitle(login: BridgeLogin): string {
  const title = login.title || 'Untitled'
  return label(login.username ? `${title} — ${login.username}` : title)
}

const showItem = (title: string): MenuItem => ({ id: `${ROOT}:show`, title })

const TYPE_LABELS: Record<BridgeFillable['type'], string> = {
  login: 'Login',
  card: 'Card',
  identity: 'ID',
  note: 'Note',
  document: 'Document'
}

/**
 * A submenu per note, card, or ID: fill the whole form by matching labels, or put one field's
 * value into the field that was right-clicked. Only labels are shown, never values.
 */
function fillableItems(fillables: BridgeFillable[]): MenuItem[] {
  if (fillables.length === 0) return []
  return [
    {
      id: `${ROOT}:fillables`,
      title: 'Notes, cards & IDs',
      children: fillables.map((item) => ({
        id: `${ROOT}:entry:${item.id}`,
        title: label(`${item.title || 'Untitled'} (${TYPE_LABELS[item.type]})`),
        children: [
          { id: `${ROOT}:form:${item.id}`, title: 'Fill matching fields' },
          { separator: true },
          ...item.labels.map((text, index) => ({
            id: `${ROOT}:field:${item.id}:${index}`,
            title: label(`Insert ${text}`)
          }))
        ]
      }))
    }
  ]
}

function errorItems(error: ClientError): MenuItem[] {
  switch (error) {
    case 'not-installed':
      return [
        {
          id: `${ROOT}:info`,
          title: 'Open the Password Manager app once to connect',
          enabled: false
        }
      ]
    case 'not-running':
    case 'timeout':
      return [showItem('Open Password Manager')]
    case 'no-vault':
      return [showItem('Set up Password Manager…')]
    case 'locked':
      return [showItem('Unlock Password Manager…')]
    default:
      return [{ id: `${ROOT}:info`, title: 'Password Manager is unavailable', enabled: false }]
  }
}

/** Works out the submenu for a page. Only titles and usernames are fetched; never passwords. */
async function menuFor(url: string | undefined): Promise<MenuItem[]> {
  if (!isWebPage(url)) {
    return [{ id: `${ROOT}:info`, title: 'Not available on this page', enabled: false }]
  }
  const token = await getToken()
  if (!token) return [{ id: `${ROOT}:connect`, title: 'Connect to Password Manager…' }]

  const status = await client.request({ type: 'status', token })
  if (!status.ok) return errorItems(status.error)
  if (!status.result.paired) {
    // Revoked in the app
    await setToken(null)
    return [{ id: `${ROOT}:connect`, title: 'Connect to Password Manager…' }]
  }
  await reloadIfUpdated(status.result.extensionVersion)
  if (status.result.state === 'locked') return errorItems('locked')
  if (status.result.state === 'no-vault') return errorItems('no-vault')

  const [logins, fillables] = await Promise.all([
    client.request({ type: 'logins', token, url }),
    client.request({ type: 'fillables', token })
  ])
  if (!logins.ok) return errorItems(logins.error)
  const items: MenuItem[] = logins.result.length
    ? logins.result.map((login) => ({ id: `${ROOT}:fill:${login.id}`, title: loginTitle(login) }))
    : [{ id: `${ROOT}:info`, title: label(`No logins for ${hostOf(url)}`), enabled: false }]
  // An app from before fillables answers bad-request; just leave the submenu out
  const extra = fillables.ok ? fillableItems(fillables.result) : []
  return [
    ...items,
    ...(extra.length ? [{ separator: true } as const, ...extra] : []),
    { separator: true },
    showItem('Open Password Manager')
  ]
}

let generation = 0

/** Rebuilds the menu. Overlapping refreshes are dropped in favor of the newest. */
async function refresh(url: string | undefined): Promise<void> {
  const current = ++generation
  let items: MenuItem[]
  try {
    items = await menuFor(url)
  } catch {
    items = errorItems('bad-request')
  }
  if (current !== generation) return

  await menus.removeAll()
  menus.create({ id: ROOT, title: 'Password Manager', contexts: ['editable'] })
  createItems(items, ROOT)
}

function createItems(items: MenuItem[], parentId: string): void {
  items.forEach((item, index) => {
    if ('separator' in item) {
      menus.create({
        id: `${parentId}:sep:${index}`,
        parentId,
        type: 'separator',
        contexts: ['editable']
      })
    } else {
      menus.create({
        id: item.id,
        parentId,
        title: item.title,
        enabled: item.enabled ?? true,
        contexts: ['editable']
      })
      if (item.children) createItems(item.children, item.id)
    }
  })
}

async function refreshActiveTab(): Promise<void> {
  const [tab] = await ext.tabs.query({ active: true, lastFocusedWindow: true })
  await refresh(tab?.url)
}

/**
 * Chromium won't update an unpacked extension, so the app replaces the files in the folder it was
 * loaded from. Reloading picks them up. Firefox updates the signed add-on itself (update_url), and
 * Chromium updates a Chrome Web Store install, whose manifest the store gives an update_url.
 */
async function reloadIfUpdated(onDisk: string | null): Promise<void> {
  const manifest = ext.runtime.getManifest()
  if (getBrowserInfo || manifest.update_url || compareVersions(onDisk, manifest.version) <= 0) {
    return
  }
  // Once per version: if this copy was loaded from some other folder, reloading changes nothing
  const stored = await ext.storage.local.get(RELOADED_FOR_KEY)
  if (stored[RELOADED_FOR_KEY] === onDisk) return
  await ext.storage.local.set({ [RELOADED_FOR_KEY]: onDisk })
  ext.runtime.reload()
}

async function browserName(): Promise<string> {
  if (getBrowserInfo) return (await getBrowserInfo()).name
  const brands =
    (navigator as { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands ?? []
  const brand = brands.find((b) => !/chromium|not.?a.?brand/i.test(b.brand))?.brand
  return brand ?? 'Chrome'
}

async function pair(): Promise<void> {
  const response = await client.request(
    { type: 'pair', browser: await browserName() },
    PAIR_TIMEOUT_MS
  )
  if (response.ok) await setToken(response.result.token)
  await refreshActiveTab()
}

async function fill(
  entryId: string,
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab
): Promise<void> {
  const token = await getToken()
  // Match against the frame that was right-clicked, which may differ from the tab's page
  const url = info.frameUrl ?? info.pageUrl ?? tab.url
  if (!token || tab.id === undefined || !isWebPage(url)) return
  const response = await client.request({ type: 'fill', token, url, entryId })
  if (!response.ok) {
    console.warn('Password Manager: fill failed:', response.error)
    return
  }
  const message: FillMessage = {
    type: 'pm-fill',
    origin: new URL(url).origin,
    ...response.result
  }
  await ext.tabs.sendMessage(tab.id, message, { frameId: info.frameId ?? 0 })
}

/** Fills the form around the right-clicked field, or just that field, from a note, card, or ID. */
async function fillFields(
  entryId: string,
  fieldIndex: number | null,
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab
): Promise<void> {
  const token = await getToken()
  const url = info.frameUrl ?? info.pageUrl ?? tab.url
  if (!token || tab.id === undefined || !isWebPage(url)) return
  const response = await client.request({ type: 'fill-fields', token, entryId })
  if (!response.ok) {
    console.warn('Password Manager: fill failed:', response.error)
    return
  }
  const fields = fieldIndex === null ? response.result : [response.result[fieldIndex]]
  if (!fields[0]) return
  const message: FillFieldsMessage = {
    type: 'pm-fill-fields',
    origin: new URL(url).origin,
    mode: fieldIndex === null ? 'form' : 'field',
    fields
  }
  await ext.tabs.sendMessage(tab.id, message, { frameId: info.frameId ?? 0 })
}

menus.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId)
  if (id === `${ROOT}:connect`) void pair()
  else if (id === `${ROOT}:show`) void client.request({ type: 'show' })
  else if (id.startsWith(`${ROOT}:fill:`) && tab) {
    void fill(id.slice(`${ROOT}:fill:`.length), info, tab)
  } else if (id.startsWith(`${ROOT}:form:`) && tab) {
    void fillFields(id.slice(`${ROOT}:form:`.length), null, info, tab)
  } else if (id.startsWith(`${ROOT}:field:`) && tab) {
    const rest = id.slice(`${ROOT}:field:`.length)
    const split = rest.lastIndexOf(':')
    void fillFields(rest.slice(0, split), Number(rest.slice(split + 1)), info, tab)
  }
})

ext.tabs.onActivated.addListener(() => void refreshActiveTab())
ext.tabs.onUpdated.addListener((_, change, tab) => {
  if (tab.active && (change.url || change.status === 'complete')) void refresh(tab.url)
})
ext.windows.onFocusChanged.addListener(() => void refreshActiveTab())
ext.runtime.onStartup.addListener(() => void refreshActiveTab())
ext.runtime.onInstalled.addListener(() => void refreshActiveTab())

// Firefox can update a menu while it's open, using the frame that was right-clicked
menus.onShown?.addListener((info) => {
  void refresh(info.frameUrl ?? info.pageUrl).then(() => menus.refresh?.())
})

void refreshActiveTab()
