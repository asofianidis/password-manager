import Foundation

/**
 * Which saved logins belong to a web page. A port of src/main/browser/match.ts, so the phone
 * fills exactly where the browser extension would.
 */
public enum UrlMatch {
    private static let localHosts: Set<String> = ["localhost", "127.0.0.1", "::1"]

    struct Site {
        var scheme: String
        var host: String
        var port: Int
        var explicitPort: Bool
    }

    /** Parses an http(s) URL the way the desktop's `new URL()` does for these purposes. */
    static func parse(_ url: String) -> Site? {
        guard let components = URLComponents(string: url.trimmed),
              let scheme = components.scheme?.lowercased(), scheme == "http" || scheme == "https",
              var host = components.host?.lowercased(), !host.isEmpty
        else { return nil }
        if host.hasPrefix("[") && host.hasSuffix("]") { host = String(host.dropFirst().dropLast()) }
        if host.hasPrefix("www.") { host = String(host.dropFirst(4)) }
        let defaultPort = scheme == "https" ? 443 : 80
        let port = components.port ?? defaultPort
        return Site(scheme: scheme, host: host, port: port, explicitPort: port != defaultPort)
    }

    /** Saved URLs are often bare domains ("example.com"); treat those as https. */
    static func parseEntryUrl(_ url: String) -> Site? {
        let trimmed = url.trimmed
        if trimmed.isEmpty { return nil }
        let hasScheme = trimmed.range(of: "^[a-z][a-z0-9+.-]*://", options: [.regularExpression, .caseInsensitive]) != nil
        return parse(hasScheme ? trimmed : "https://\(trimmed)")
    }

    /** The host a saved login's URL names, without "www.", or nil if it isn't a website. */
    public static func host(of entryUrl: String) -> String? {
        parseEntryUrl(entryUrl)?.host
    }

    private static func isIp(_ host: String) -> Bool {
        host.contains(":") || host.allSatisfy { $0 == "." || $0.isASCIIDigit }
    }

    /**
     * Whether other sites can live under this host. A public suffix such as `co.uk` or
     * `github.io` is shared by unrelated owners, so a login saved for it must not fill on
     * `evil.github.io`.
     */
    private static func canHaveOwnSubdomains(_ host: String) -> Bool {
        if !host.contains(".") || isIp(host) { return false }
        return PublicSuffix.registrableDomain(host) != nil
    }

    /**
     * How well a saved login's URL matches the page being filled: 2 for the same host, 1 when
     * the page is on a subdomain of the saved host (unless the saved host is a public suffix),
     * 0 for no match. An https login never matches a plain http page (except localhost).
     */
    public static func matchLevel(entryUrl: String, pageUrl: String) -> Int {
        guard let entry = parseEntryUrl(entryUrl), let page = parse(pageUrl) else { return 0 }
        if page.scheme == "http" && entry.scheme == "https" && !localHosts.contains(page.host) { return 0 }
        if entry.explicitPort && entry.port != page.port { return 0 }
        if entry.host == page.host { return 2 }
        if !canHaveOwnSubdomains(entry.host) { return 0 }
        return page.host.hasSuffix(".\(entry.host)") ? 1 : 0
    }

    /** Logins for a web page, best match first. */
    public static func forPage(_ entries: [VaultEntry], pageUrl: String) -> [VaultEntry] {
        entries.map { ($0, matchLevel(entryUrl: $0.url, pageUrl: pageUrl)) }
            .filter { $0.1 > 0 }
            .sorted { a, b in a.1 != b.1 ? a.1 > b.1 : a.0.title.lowercased() < b.0.title.lowercased() }
            .map(\.0)
    }
}

/**
 * The Public Suffix List (ICANN and private domains), as the desktop's tldts uses with
 * `allowPrivateDomains`. Refresh Resources/public_suffix_list.dat from
 * https://publicsuffix.org/list/public_suffix_list.dat (the Android app ships the same file).
 *
 * Rules and hosts are compared as written: hosts arrive from URLs in punycode, and the
 * Unicode rules in the list only matter for Unicode hosts.
 */
public enum PublicSuffix {
    private struct Rules {
        var normal = Set<String>()
        var wildcard = Set<String>()
        var exception = Set<String>()
    }

    private static let rules: Rules = {
        var r = Rules()
        guard let url = Bundle.module.url(forResource: "public_suffix_list", withExtension: "dat"),
              let text = try? String(contentsOf: url, encoding: .utf8)
        else { fatalError("public_suffix_list.dat is missing") }
        for raw in text.split(whereSeparator: \.isNewline) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("//") { continue }
            let rule = String(line.split(separator: " ")[0]).lowercased()
            if rule.hasPrefix("!") {
                r.exception.insert(String(rule.dropFirst()))
            } else if rule.hasPrefix("*.") {
                r.wildcard.insert(String(rule.dropFirst(2)))
            } else {
                r.normal.insert(rule)
            }
        }
        return r
    }()

    /** How many trailing labels of the host form its public suffix. */
    private static func suffixLength(_ labels: [String]) -> Int {
        let r = rules
        var best = 1 // the implicit "*" rule
        for i in labels.indices {
            let candidate = labels[i...].joined(separator: ".")
            let length = labels.count - i
            // Iterating from the longest candidate, the first exception found wins
            if r.exception.contains(candidate) { return length - 1 }
            if r.normal.contains(candidate) { best = max(best, length) }
            if i + 1 < labels.count && r.wildcard.contains(labels[(i + 1)...].joined(separator: ".")) {
                best = max(best, length)
            }
        }
        return best
    }

    /** The registrable domain ("bbc.co.uk" for "news.bbc.co.uk"), or nil for a public suffix itself. */
    public static func registrableDomain(_ host: String) -> String? {
        var name = host.lowercased()
        while name.hasSuffix(".") { name.removeLast() }
        let labels = name.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        if labels.contains(where: \.isEmpty) { return nil }
        let length = suffixLength(labels)
        if labels.count <= length { return nil }
        return labels.suffix(length + 1).joined(separator: ".")
    }
}
