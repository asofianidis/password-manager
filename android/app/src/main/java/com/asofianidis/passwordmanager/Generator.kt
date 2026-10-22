package com.asofianidis.passwordmanager

import android.content.Context
import java.security.SecureRandom

/** Password generator, matching src/main/generator.ts on the desktop. */
class Generator(context: Context) {
    private val random = SecureRandom()

    /** The EFF large diceware list (7,776 words, ~12.9 bits each). */
    private val words: List<String> by lazy {
        context.assets.open("eff_large_wordlist.txt").bufferedReader().readLines().filter { it.isNotBlank() }
    }

    fun generate(options: GeneratorOptions): String =
        if (options.passphrase) passphrase(options) else randomPassword(options)

    private fun randomPassword(options: GeneratorOptions): String {
        val sets = listOfNotNull(
            UPPERCASE.takeIf { options.uppercase },
            LOWERCASE.takeIf { options.lowercase },
            DIGITS.takeIf { options.digits },
            SYMBOLS.takeIf { options.symbols },
        ).map { set -> if (options.excludeAmbiguous) set.filterNot { it in AMBIGUOUS } else set }
            .ifEmpty { listOf(LOWERCASE) }
        val length = maxOf(options.length, sets.size)
        // Guarantee at least one character from each enabled set
        val chars = sets.map { it.pick() }.toMutableList()
        val all = sets.joinToString("")
        while (chars.size < length) chars += all.pick()
        for (i in chars.indices.reversed()) {
            val j = random.nextInt(i + 1)
            chars[i] = chars[j].also { chars[j] = chars[i] }
        }
        return chars.joinToString("")
    }

    private fun passphrase(options: GeneratorOptions): String {
        val picked = MutableList(options.words) {
            val word = words[random.nextInt(words.size)]
            if (options.capitalize) word.replaceFirstChar { it.uppercaseChar() } else word
        }
        if (options.includeNumber && picked.isNotEmpty()) {
            val index = random.nextInt(picked.size)
            picked[index] = picked[index] + random.nextInt(10)
        }
        return picked.joinToString(options.separator)
    }

    private fun String.pick(): Char = this[random.nextInt(length)]

    companion object {
        private const val UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        private const val LOWERCASE = "abcdefghijklmnopqrstuvwxyz"
        private const val DIGITS = "0123456789"
        private const val SYMBOLS = "!@#$%^&*()-_=+[]{};:,.<>?/~"
        private const val AMBIGUOUS = "Il1O0o|`'\";:,."
    }
}
