import { cn } from '@renderer/lib/cn'

export function Monogram({ title, large }: { title: string; large?: boolean }): React.JSX.Element {
  const letter = (title.trim()[0] ?? '?').toUpperCase()
  const hue = [...title].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg font-semibold text-white',
        large ? 'size-12 text-xl' : 'size-8 text-sm'
      )}
      style={{ backgroundColor: `hsl(${hue} 45% 35%)` }}
    >
      {letter}
    </span>
  )
}
