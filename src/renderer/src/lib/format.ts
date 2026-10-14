import type { StrengthScore } from '@shared/types'

export const STRENGTH_LABELS: Record<StrengthScore, string> = {
  0: 'Very weak',
  1: 'Weak',
  2: 'Fair',
  3: 'Strong',
  4: 'Very strong'
}

export const strengthText: Record<StrengthScore, string> = {
  0: 'text-danger',
  1: 'text-danger',
  2: 'text-warn',
  3: 'text-ok',
  4: 'text-accent'
}

export const strengthBg: Record<StrengthScore, string> = {
  0: 'bg-danger',
  1: 'bg-danger',
  2: 'bg-warn',
  3: 'bg-ok',
  4: 'bg-accent'
}

export function hostOf(url: string): string {
  if (!url) return ''
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function openableUrl(url: string): string | null {
  if (!url) return null
  const candidate = url.includes('://') ? url : `https://${url}`
  return /^https?:\/\//i.test(candidate) ? candidate : null
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

export function timeAgo(timestamp: number | null): string {
  if (!timestamp) return 'never'
  const seconds = Math.round((timestamp - Date.now()) / 1000)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60]
  ]
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}
