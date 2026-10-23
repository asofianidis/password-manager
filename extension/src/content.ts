/**
 * Runs in every frame. Remembers which field was right-clicked, and fills the login form around
 * it when the background script sends credentials, or any form from a note, card, or ID.
 */
import {
  conceptFromAutocomplete,
  conceptFromText,
  expandFields,
  formatForControl,
  matchFields,
  type ControlInfo,
  type FillField
} from '../../src/shared/fill'

export interface FillMessage {
  type: 'pm-fill'
  /** The origin the app matched the login against; the frame must still be on it */
  origin: string
  username: string
  password: string
}

export interface FillFieldsMessage {
  type: 'pm-fill-fields'
  /** The frame the user right-clicked; it must still be on it */
  origin: string
  /** form: fill every control a field matches; field: put fields[0] into the right-clicked one */
  mode: 'form' | 'field'
  fields: FillField[]
}

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

/** Ignore a remembered right-click this old; the user has likely moved on */
const TARGET_TTL_MS = 60_000
const USERNAME_HINT = /user|email|login|account|identifier/i
const TEXT_TYPES = new Set(['text', 'email', 'tel'])
/** Inputs that never take a note's value */
const SKIPPED_TYPES = new Set([
  'hidden',
  'password',
  'checkbox',
  'radio',
  'file',
  'submit',
  'button',
  'reset',
  'image',
  'range',
  'color'
])

let target: HTMLInputElement | HTMLTextAreaElement | null = null
let targetAt = 0

document.addEventListener(
  'contextmenu',
  (event) => {
    // composedPath reaches into open shadow roots, where event.target would stop at the host
    const element = event.composedPath()[0]
    target =
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element : null
    targetAt = Date.now()
  },
  true
)

function usable(input: Control): boolean {
  if (input.disabled || ('readOnly' in input && input.readOnly)) return false
  const style = getComputedStyle(input)
  return input.getClientRects().length > 0 && style.visibility !== 'hidden'
}

const precedes = (a: Node, b: Node): boolean =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

const looksLikeUsername = (input: HTMLInputElement): boolean =>
  /username|email/.test(input.autocomplete) ||
  USERNAME_HINT.test(`${input.name} ${input.id} ${input.placeholder}`)

/** The right-clicked field if it's still there, else the focused one. */
function startField(): HTMLInputElement | HTMLTextAreaElement | null {
  if (target?.isConnected && Date.now() - targetAt < TARGET_TTL_MS) return target
  const active = document.activeElement
  return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : null
}

/** The form around a field. Fields in a shadow root aren't reachable from the document. */
const formRoot = (start: Element | null): ParentNode =>
  (start instanceof HTMLInputElement || start instanceof HTMLTextAreaElement
    ? (start.form ?? start.closest('form') ?? start.getRootNode())
    : document) as ParentNode

function findFields(start: HTMLInputElement | null): {
  username: HTMLInputElement | null
  password: HTMLInputElement | null
} {
  const fields = [...formRoot(start).querySelectorAll('input')].filter(usable)
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
function setValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  input.focus()
  if (setter) setter.call(input, value)
  else input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

const squash = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/** Picks the option of a select that best fits a value: same text or value, or the same number. */
function selectOption(select: HTMLSelectElement, value: string): boolean {
  const wanted = squash(value)
  if (!wanted) return false
  const options = [...select.options].filter((o) => !o.disabled)
  const numeric = /^\d+$/.test(value) ? Number(value) : null
  const option =
    options.find((o) => squash(o.value) === wanted || squash(o.text) === wanted) ??
    (numeric === null
      ? undefined
      : options.find(
          (o) =>
            Number(o.value) === numeric ||
            Number(o.text) === numeric ||
            // Two-digit years in a list of four-digit ones, or the other way round
            (value.length === 2 && o.value.endsWith(value) && o.value.length === 4) ||
            (value.length === 4 && o.value.length === 2 && value.endsWith(o.value))
        )) ??
    (wanted.length >= 3 ? options.find((o) => squash(o.text).startsWith(wanted)) : undefined)
  if (!option) return false
  select.value = option.value
  select.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
  select.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}

/** The visible text that labels a control: <label for>, a wrapping label, or aria-labelledby. */
function labelText(control: Control): string {
  const parts = [...(control.labels ?? [])].map((l) => l.textContent ?? '')
  const root = control.getRootNode() as Document | ShadowRoot
  for (const id of (control.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)) {
    parts.push(root.getElementById?.(id)?.textContent ?? '')
  }
  return parts.join(' ').slice(0, 200)
}

function describe(control: Control): ControlInfo & { maxLength: number } {
  const text = [
    control.name,
    control.id,
    'placeholder' in control ? control.placeholder : '',
    control.getAttribute('aria-label') ?? '',
    labelText(control)
  ].join(' ')
  return {
    concept: conceptFromAutocomplete(control.autocomplete ?? '') ?? conceptFromText(text),
    text,
    maxLength: 'maxLength' in control ? control.maxLength : -1
  }
}

function fillControl(
  control: Control,
  field: FillField,
  info: { text: string; maxLength: number }
): boolean {
  const value = formatForControl(field, info)
  if (control instanceof HTMLSelectElement) return selectOption(control, value)
  setValue(control, value)
  return true
}

/** Fills every control in the form that a field matches. Returns how many were filled. */
function fillForm(fields: FillField[]): number {
  const start = startField()
  const controls = [...formRoot(start).querySelectorAll('input, textarea, select')].filter(
    (el): el is Control =>
      (el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        (el instanceof HTMLInputElement && !SKIPPED_TYPES.has(el.type))) &&
      usable(el)
  )
  const expanded = expandFields(fields)
  const infos = controls.map(describe)
  const chosen = matchFields(expanded, infos)
  let filled = 0
  chosen.forEach((field, i) => {
    if (field >= 0 && fillControl(controls[i], expanded[field], infos[i])) filled++
  })
  // Nothing matched: at least put the first field where the user right-clicked
  if (filled === 0 && start && fields[0]) {
    setValue(start, formatForControl(fields[0], describe(start)))
    filled = 1
  }
  return filled
}

chrome.runtime.onMessage.addListener(
  (message: FillMessage | FillFieldsMessage, _sender, sendResponse) => {
    if (message?.type !== 'pm-fill' && message?.type !== 'pm-fill-fields') return
    // The frame could have navigated since the user picked what to fill
    if (location.origin !== message.origin) return sendResponse({ filled: false })

    if (message.type === 'pm-fill-fields') {
      if (message.mode === 'form') return sendResponse({ filled: fillForm(message.fields) > 0 })
      const start = startField()
      if (start && message.fields[0]) setValue(start, message.fields[0].value)
      return sendResponse({ filled: Boolean(start) })
    }

    const start = startField()
    const { username, password } = findFields(start instanceof HTMLInputElement ? start : null)
    if (username && message.username) setValue(username, message.username)
    if (password && message.password) setValue(password, message.password)
    sendResponse({ filled: Boolean(username || password) })
  }
)
