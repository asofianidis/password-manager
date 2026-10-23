import { ZxcvbnFactory } from '@zxcvbn-ts/core'
import * as zxcvbnCommon from '@zxcvbn-ts/language-common'
import * as zxcvbnEn from '@zxcvbn-ts/language-en'
import { entryDetail } from '../shared/entries'
import type {
  EntrySummary,
  HealthReport,
  StrengthResult,
  StrengthScore,
  VaultEntry
} from '../shared/types'

let factory: ZxcvbnFactory | null = null

function zxcvbn(): ZxcvbnFactory {
  factory ??= new ZxcvbnFactory({
    translations: zxcvbnEn.translations,
    graphs: zxcvbnCommon.adjacencyGraphs,
    dictionary: { ...zxcvbnCommon.dictionary, ...zxcvbnEn.dictionary }
  })
  return factory
}

export function checkStrength(password: string, userInputs: string[] = []): StrengthResult {
  if (!password)
    return { score: 0, warning: 'Password is empty', suggestions: [], crackTime: 'instantly' }
  const result = zxcvbn().check(password.slice(0, 256), userInputs.filter(Boolean))
  return {
    score: result.score as StrengthScore,
    warning: result.feedback.warning || null,
    suggestions: result.feedback.suggestions,
    crackTime: result.crackTimes.offlineSlowHashingXPerSecond.display
  }
}

/** Scores are cached per entry revision since zxcvbn takes a few ms per password. */
const scoreCache = new Map<string, { updatedAt: number; score: StrengthScore }>()

function entryScore(entry: VaultEntry): StrengthScore {
  const cached = scoreCache.get(entry.id)
  if (cached && cached.updatedAt === entry.updatedAt) return cached.score
  const { score } = checkStrength(entry.password, [entry.username, entry.title])
  scoreCache.set(entry.id, { updatedAt: entry.updatedAt, score })
  return score
}

export function clearStrengthCache(): void {
  scoreCache.clear()
}

export function summarize(entries: VaultEntry[], oldPasswordDays: number): EntrySummary[] {
  const cutoff = Date.now() - oldPasswordDays * 24 * 60 * 60 * 1000
  const passwordCounts = new Map<string, number>()
  for (const entry of entries) {
    if (isLogin(entry) && entry.password)
      passwordCounts.set(entry.password, (passwordCounts.get(entry.password) ?? 0) + 1)
  }
  return entries.map((entry) => {
    // Only logins have passwords worth scoring
    const login = isLogin(entry)
    const hasPassword = login && entry.password.length > 0
    return {
      id: entry.id,
      type: entry.type ?? 'login',
      title: entry.title,
      detail: entryDetail(entry),
      attachments: entry.attachments?.length ?? 0,
      username: login ? entry.username : '',
      url: entry.url,
      folder: entry.folder,
      favorite: entry.favorite,
      hasPassword,
      hasTotp: login && entry.totp.length > 0,
      score: hasPassword ? entryScore(entry) : 0,
      reused: hasPassword && (passwordCounts.get(entry.password) ?? 0) > 1,
      old: hasPassword && entry.passwordUpdatedAt < cutoff,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      passwordUpdatedAt: entry.passwordUpdatedAt
    }
  })
}

const isLogin = (entry: VaultEntry): boolean => !entry.type

/** A password is considered weak when zxcvbn scores it 0-2 (crackable in under ~10^8 guesses). */
export const WEAK_SCORE_THRESHOLD = 2

export function healthReport(entries: VaultEntry[], oldPasswordDays: number): HealthReport {
  const summaries = summarize(entries.filter(isLogin), oldPasswordDays)
  const withPassword = summaries.filter((s) => s.hasPassword)
  const weak = withPassword.filter((s) => s.score <= WEAK_SCORE_THRESHOLD)
  const reused = withPassword.filter((s) => s.reused)
  const old = withPassword.filter((s) => s.old)
  const empty = summaries.filter((s) => !s.hasPassword)

  const atRisk = new Set([...weak, ...reused].map((s) => s.id))
  const score =
    withPassword.length === 0
      ? 100
      : Math.round(((withPassword.length - atRisk.size) / withPassword.length) * 100)

  const byScore = (a: EntrySummary, b: EntrySummary): number => a.score - b.score
  return {
    total: summaries.length,
    weak: weak.sort(byScore),
    reused: reused.sort((a, b) => a.title.localeCompare(b.title)),
    old: old.sort((a, b) => a.passwordUpdatedAt - b.passwordUpdatedAt),
    empty,
    score
  }
}
