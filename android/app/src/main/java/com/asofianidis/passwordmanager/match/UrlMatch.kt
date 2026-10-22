package com.asofianidis.passwordmanager.match

import com.asofianidis.passwordmanager.vault.VaultEntry
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Which saved logins belong to a web page or an app. The web rules are a port of
 * src/main/browser/match.ts, so the phone fills exactly where the browser extension would.
 */
object UrlMatch {
    private val LOCAL_HOSTS = setOf("localhost", "127.0.0.1", "::1")

    /** Prefix for logins saved from an app instead of a website (the convention other managers use). */
    const val APP_SCHEME = "androidapp://"

    private class Site(val scheme: String, val host: String, val port: Int, val explicitPort: Boolean)

    private fun site(url: HttpUrl) = Site(
        scheme = url.scheme,
        host = url.host.lowercase().removePrefix("www."),
        port = url.port,
        explicitPort = url.port != HttpUrl.defaultPort(url.scheme),
    )

    private fun parse(url: String): Site? = url.toHttpUrlOrNull()?.let(::site)

    /** Saved URLs are often bare domains ("example.com"); treat those as https. */
    private fun parseEntryUrl(url: String): Site? {
        val trimmed = url.trim()
        if (trimmed.isEmpty()) return null
        val hasScheme = Regex("^[a-z][a-z\\d+.-]*://", RegexOption.IGNORE_CASE).containsMatchIn(trimmed)
        return parse(if (hasScheme) trimmed else "https://$trimmed")
    }

    private fun isIp(host: String) = host.matches(Regex("^[\\d.]+$")) || host.contains(':')

    /**
     * Whether other sites can live under this host. A public suffix such as `co.uk` or
     * `github.io` is shared by unrelated owners, so a login saved for it must not fill on
     * `evil.github.io`.
     */
    private fun canHaveOwnSubdomains(host: String): Boolean {
        if (!host.contains('.') || isIp(host)) return false
        return PublicSuffix.registrableDomain(host) != null
    }

    /**
     * How well a saved login's URL matches the page being filled: 2 for the same host, 1 when
     * the page is on a subdomain of the saved host (unless the saved host is a public suffix),
     * 0 for no match. An https login never matches a plain http page (except localhost).
     */
    fun matchLevel(entryUrl: String, pageUrl: String): Int {
        val entry = parseEntryUrl(entryUrl) ?: return 0
        val page = parse(pageUrl) ?: return 0
        if (page.scheme == "http" && entry.scheme == "https" && page.host !in LOCAL_HOSTS) return 0
        if (entry.explicitPort && entry.port != page.port) return 0
        if (entry.host == page.host) return 2
        if (!canHaveOwnSubdomains(entry.host)) return 0
        return if (page.host.endsWith(".${entry.host}")) 1 else 0
    }

    /** Logins for a web page, best match first. */
    fun forPage(entries: List<VaultEntry>, pageUrl: String): List<VaultEntry> =
        entries.map { it to matchLevel(it.url, pageUrl) }
            .filter { it.second > 0 }
            .sortedWith(compareByDescending<Pair<VaultEntry, Int>> { it.second }.thenBy { it.first.title.lowercase() })
            .map { it.first }

    fun appUrl(packageName: String) = "$APP_SCHEME$packageName"

    /** Logins saved for this app, or that the user chose to use in it before. */
    fun forApp(entries: List<VaultEntry>, packageName: String, linkedIds: Set<String>): List<VaultEntry> =
        entries.filter { it.url.trim().equals(appUrl(packageName), ignoreCase = true) || it.id in linkedIds }
            .sortedBy { it.title.lowercase() }

    /**
     * Logins that probably belong to an app, judged by its package name ("com.github.android"
     * suggests github.com). Only shown as suggestions in the picker, never filled automatically:
     * any app can pick any package name.
     */
    fun suggestionsForApp(entries: List<VaultEntry>, packageName: String): List<VaultEntry> {
        val segments = packageName.lowercase().split('.').filter { it.length >= 3 && it !in GENERIC_SEGMENTS }.toSet()
        if (segments.isEmpty()) return emptyList()
        return entries.filter { entry ->
            val host = parseEntryUrl(entry.url)?.host ?: return@filter false
            val label = (PublicSuffix.registrableDomain(host) ?: host).substringBefore('.')
            label.length >= 3 && (label in segments || entry.title.lowercase().replace(" ", "") in segments)
        }
    }

    private val GENERIC_SEGMENTS = setOf(
        "com", "org", "net", "app", "android", "mobile", "apps", "client", "www", "the",
    )
}
