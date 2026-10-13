import type { ReactNode } from 'react'

type Props = { children: ReactNode }

export function Comment({ children }: Props): React.JSX.Element {
  return <span className="text-syn-comment italic">{children}</span>
}

export function Kw({ children }: Props): React.JSX.Element {
  return <span className="text-syn-keyword">{children}</span>
}

export function Str({ children }: Props): React.JSX.Element {
  return <span className="text-syn-string">&quot;{children}&quot;</span>
}

export function Num({ children }: Props): React.JSX.Element {
  return <span className="text-syn-number">{children}</span>
}

export function Prop({ children }: Props): React.JSX.Element {
  return <span className="text-syn-prop">{children}</span>
}

export function Fn({ children }: Props): React.JSX.Element {
  return <span className="text-syn-fn">{children}</span>
}

export function Type({ children }: Props): React.JSX.Element {
  return <span className="text-syn-type">{children}</span>
}

export function Punc({ children }: Props): React.JSX.Element {
  return <span className="text-ide-muted">{children}</span>
}
