import { AlertTriangle, Info, XCircle } from 'lucide-react'
import type { EntrySummary } from '@shared/types'
import { STRENGTH_LABELS } from './format'

export type Severity = 'error' | 'warning' | 'info'

export interface Problem {
  severity: Severity
  icon: typeof XCircle
  color: string
  message: string
  fixable: boolean
}

export const SEVERITY_STYLE: Record<Severity, { icon: typeof XCircle; color: string }> = {
  error: { icon: XCircle, color: 'text-syn-prop' },
  warning: { icon: AlertTriangle, color: 'text-syn-type' },
  info: { icon: Info, color: 'text-ide-accent' }
}

/** Password-health issues for one credential, phrased like compiler diagnostics. */
export function entryProblems(summary: EntrySummary, crackTime?: string): Problem[] {
  const problems: Problem[] = []
  if (!summary.hasPassword) return problems
  if (summary.score <= 2) {
    problems.push({
      severity: 'error',
      ...SEVERITY_STYLE.error,
      message: `Weak password (${STRENGTH_LABELS[summary.score].toLowerCase()})${crackTime ? `, could be cracked in ${crackTime}` : ''}`,
      fixable: true
    })
  }
  if (summary.reused) {
    problems.push({
      severity: 'warning',
      ...SEVERITY_STYLE.warning,
      message: 'Password is reused by another credential',
      fixable: true
    })
  }
  if (summary.old) {
    problems.push({
      severity: 'info',
      ...SEVERITY_STYLE.info,
      message: `Password unchanged since ${new Date(summary.passwordUpdatedAt).toLocaleDateString()}`,
      fixable: false
    })
  }
  return problems
}
