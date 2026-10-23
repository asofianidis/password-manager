import type { EntryType } from '@shared/types'
import { cn } from '@renderer/lib/cn'
import { TYPE_ICONS } from '@renderer/lib/entry-types'
import { Monogram } from './ui'

const TYPE_TINTS: Record<Exclude<EntryType, 'login'>, string> = {
  card: 'bg-[#1d2f45] text-[#7db4ef]',
  identity: 'bg-[#2c2445] text-[#b39cf0]',
  note: 'bg-[#3a311a] text-[#f2c45b]',
  document: 'bg-[#1d3a33] text-[#6fd3b5]'
}

/** A login's monogram, or a tile with the type's icon for everything else. */
export function EntryIcon({
  type,
  title,
  url,
  size = 'md'
}: {
  type: EntryType
  title: string
  url?: string
  size?: 'sm' | 'md' | 'lg'
}): React.JSX.Element {
  if (type === 'login') return <Monogram title={title} url={url} size={size} />
  const Icon = TYPE_ICONS[type]
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center',
        TYPE_TINTS[type],
        size === 'sm' && 'size-7 rounded-lg',
        size === 'md' && 'size-9 rounded-[10px]',
        size === 'lg' && 'size-14 rounded-2xl'
      )}
    >
      <Icon className={cn(size === 'sm' ? 'size-3.5' : size === 'md' ? 'size-4' : 'size-6')} />
    </span>
  )
}
