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
 * How well a saved login's URL matches the page being filled: 2 for the same host, 1 when the
 * page is on a subdomain of the saved host, 0 for no match. An https login never matches a plain
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
  // A bare TLD or an IP can't have subdomains worth matching
  if (!entry.host.includes('.') || isIp(entry.host)) return 0
  return page.host.endsWith(`.${entry.host}`) ? 1 : 0
}
