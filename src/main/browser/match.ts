import { getDomain } from 'tldts'

interface Site {
  protocol: string
  host: string
  port: string
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function parse(url: string): Site | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return {
      protocol: u.protocol,
      host: u.hostname.toLowerCase().replace(/^www\./, ''),
      port: u.port
    }
  } catch {
    return null
  }
}

/** Saved URLs are often bare domains ("example.com"); treat those as https. */
function parseEntryUrl(url: string): Site | null {
  const trimmed = url.trim()
  if (!trimmed) return null
  return parse(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
}

const isIp = (host: string): boolean => /^[\d.]+$/.test(host) || host.startsWith('[')

/**
 * Whether other sites can live under this host. A public suffix such as `co.uk` or `github.io`
 * (private domains from the Public Suffix List count too) is shared by unrelated owners, so a
 * login saved for it must not fill on `evil.github.io`.
 */
function canHaveOwnSubdomains(host: string): boolean {
  if (!host.includes('.') || isIp(host)) return false
  return getDomain(host, { allowPrivateDomains: true }) !== null
}

/**
 * How well a saved login's URL matches the page being filled: 2 for the same host, 1 when the
 * page is on a subdomain of the saved host (unless the saved host is a public suffix), 0 for no
 * match. An https login never matches a plain
 * http page (except localhost), so a downgraded connection can't receive the password.
 */
export function matchLevel(entryUrl: string, pageUrl: string): 0 | 1 | 2 {
  const entry = parseEntryUrl(entryUrl)
  const page = parse(pageUrl)
  if (!entry || !page) return 0
  if (page.protocol === 'http:' && entry.protocol === 'https:' && !LOCAL_HOSTS.has(page.host)) {
    return 0
  }
  if (entry.port && entry.port !== page.port) return 0
  if (entry.host === page.host) return 2
  if (!canHaveOwnSubdomains(entry.host)) return 0
  return page.host.endsWith(`.${entry.host}`) ? 1 : 0
}
