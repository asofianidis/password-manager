import { randomInt } from 'crypto'
import { dictionary } from '@zxcvbn-ts/language-common'
import type { GeneratedPassword, GeneratorOptions } from '../shared/types'
import { checkStrength } from './strength'

const SETS = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.<>?/~'
}
const AMBIGUOUS = /[Il1O0o|`'";:,.]/g

/** The EFF large diceware list (7,776 words, ~12.9 bits each). */
const WORDS = dictionary['diceware-common']

function pickChar(chars: string): string {
  return chars[randomInt(chars.length)]
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

function randomPassword(options: GeneratorOptions): string {
  const sets = (Object.keys(SETS) as (keyof typeof SETS)[])
    .filter((name) => options[name])
    .map((name) => (options.excludeAmbiguous ? SETS[name].replace(AMBIGUOUS, '') : SETS[name]))
  if (sets.length === 0) sets.push(SETS.lowercase)

  const length = Math.max(options.length, sets.length)
  // Guarantee at least one character from each enabled set
  const chars = sets.map(pickChar)
  const all = sets.join('')
  while (chars.length < length) chars.push(pickChar(all))
  return shuffle(chars).join('')
}

function passphrase(options: GeneratorOptions): string {
  const words = Array.from({ length: options.words }, () => {
    const word = WORDS[randomInt(WORDS.length)]
    return options.capitalize ? word[0].toUpperCase() + word.slice(1) : word
  })
  if (options.includeNumber) {
    const index = randomInt(words.length)
    words[index] = `${words[index]}${randomInt(10)}`
  }
  return words.join(options.separator)
}

export function generatePassword(options: GeneratorOptions): GeneratedPassword {
  const password = options.mode === 'passphrase' ? passphrase(options) : randomPassword(options)
  return { password, strength: checkStrength(password) }
}
