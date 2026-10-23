import { CreditCard, FileText, IdCard, KeyRound, StickyNote, type LucideIcon } from 'lucide-react'
import type { EntryType } from '@shared/types'

export const TYPE_ICONS: Record<EntryType, LucideIcon> = {
  login: KeyRound,
  card: CreditCard,
  identity: IdCard,
  note: StickyNote,
  document: FileText
}
