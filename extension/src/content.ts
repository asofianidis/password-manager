/**
 * Runs in every frame. Remembers which field was right-clicked, and fills the login form around
 * it when the background script sends credentials.
 */

export interface FillMessage {
  type: 'pm-fill'
  /** The origin the app matched the login against; the frame must still be on it */
  origin: string
  username: string
  password: string
}

/** Ignore a remembered right-click this old; the user has likely moved on */
const TARGET_TTL_MS = 60_000
const USERNAME_HINT = /user|email|login|account|identifier/i
const TEXT_TYPES = new Set(['text', 'email', 'tel'])

let target: HTMLInputElement | null = null
let targetAt = 0

document.addEventListener(
  'contextmenu',
  (event) => {
    // composedPath reaches into open shadow roots, where event.target would stop at the host
    const element = event.composedPath()[0]
    target = element instanceof HTMLInputElement ? element : null
    targetAt = Date.now()
  },
  true
)

function usable(input: HTMLInputElement): boolean {
  if (input.disabled || input.readOnly) return false
  const style = getComputedStyle(input)
  return input.getClientRects().length > 0 && style.visibility !== 'hidden'
}

const precedes = (a: Node, b: Node): boolean =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

const looksLikeUsername = (input: HTMLInputElement): boolean =>
  /username|email/.test(input.autocomplete) ||
  USERNAME_HINT.test(`${input.name} ${input.id} ${input.placeholder}`)

function findFields(start: HTMLInputElement | null): {
  username: HTMLInputElement | null
  password: HTMLInputElement | null
} {
  // Fields in a shadow root aren't reachable from the document, so search the field's own root
  const root = (start?.form ??
    start?.closest('form') ??
    start?.getRootNode() ??
    document) as ParentNode
  const fields = [...root.querySelectorAll('input')].filter(usable)
  const texts = fields.filter((input) => TEXT_TYPES.has(input.type))

  const password =
    start?.type === 'password' ? start : (fields.find((input) => input.type === 'password') ?? null)

  if (start && TEXT_TYPES.has(start.type)) return { username: start, password }
  if (password) {
    // The username is normally the text field right before the password
    const before = texts.filter((input) => precedes(input, password))
    return {
      username: before.findLast(looksLikeUsername) ?? before.at(-1) ?? null,
      password
    }
  }
  // A username-only step, as in two-page logins
  return { username: texts.find(looksLikeUsername) ?? texts[0] ?? null, password: null }
}

/** Sets a value the way typing would, so frameworks like React see the change. */
function setValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  input.focus()
  if (setter) setter.call(input, value)
  else input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

chrome.runtime.onMessage.addListener((message: FillMessage, _sender, sendResponse) => {
  if (message?.type !== 'pm-fill') return
  // The frame could have navigated since the app matched the login against its URL
  if (location.origin !== message.origin) return sendResponse({ filled: false })

  const start =
    target?.isConnected && Date.now() - targetAt < TARGET_TTL_MS
      ? target
      : document.activeElement instanceof HTMLInputElement
        ? document.activeElement
        : null
  const { username, password } = findFields(start)
  if (username && message.username) setValue(username, message.username)
  if (password && message.password) setValue(password, message.password)
  sendResponse({ filled: Boolean(username || password) })
})
