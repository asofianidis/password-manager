package com.asofianidis.passwordmanager.match

import java.net.IDN

/**
 * The Public Suffix List (ICANN and private domains), as the desktop's tldts uses with
 * `allowPrivateDomains`. The list ships as a resource next to this class; refresh it from
 * https://publicsuffix.org/list/public_suffix_list.dat.
 */
object PublicSuffix {
    private class Rules(val normal: Set<String>, val wildcard: Set<String>, val exception: Set<String>)

    private val rules: Rules by lazy {
        val normal = HashSet<String>()
        val wildcard = HashSet<String>()
        val exception = HashSet<String>()
        val stream = PublicSuffix::class.java.getResourceAsStream("public_suffix_list.dat")
            ?: error("public_suffix_list.dat is missing")
        stream.bufferedReader().useLines { lines ->
            for (raw in lines) {
                val line = raw.trim()
                if (line.isEmpty() || line.startsWith("//")) continue
                val rule = line.substringBefore(' ')
                when {
                    rule.startsWith("!") -> exception += ascii(rule.substring(1))
                    rule.startsWith("*.") -> wildcard += ascii(rule.substring(2))
                    else -> normal += ascii(rule)
                }
            }
        }
        Rules(normal, wildcard, exception)
    }

    private fun ascii(domain: String) = runCatching { IDN.toASCII(domain) }.getOrDefault(domain).lowercase()

    /** How many trailing labels of the host form its public suffix. */
    private fun suffixLength(labels: List<String>): Int {
        val r = rules
        var best = 1 // the implicit "*" rule
        for (i in labels.indices) {
            val candidate = labels.subList(i, labels.size).joinToString(".")
            val length = labels.size - i
            // Iterating from the longest candidate, the first exception found wins
            if (candidate in r.exception) return length - 1
            if (candidate in r.normal) best = maxOf(best, length)
            if (i + 1 < labels.size && labels.subList(i + 1, labels.size).joinToString(".") in r.wildcard) {
                best = maxOf(best, length)
            }
        }
        return best
    }

    /** The registrable domain ("bbc.co.uk" for "news.bbc.co.uk"), or null for a public suffix itself. */
    fun registrableDomain(host: String): String? {
        val labels = host.lowercase().trimEnd('.').split('.')
        if (labels.any { it.isEmpty() }) return null
        val length = suffixLength(labels)
        if (labels.size <= length) return null
        return labels.takeLast(length + 1).joinToString(".")
    }
}
