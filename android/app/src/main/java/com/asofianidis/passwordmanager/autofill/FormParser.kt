package com.asofianidis.passwordmanager.autofill

import android.app.assist.AssistStructure
import android.text.InputType
import android.view.View
import android.view.autofill.AutofillId

/** The login fields found on a screen, and where the screen came from. */
data class LoginForm(
    val packageName: String,
    /** The page's domain, reported by the app (only trusted from known browsers, see [pageUrl]) */
    val webDomain: String?,
    val webScheme: String?,
    val usernameIds: List<AutofillId>,
    val passwordIds: List<AutofillId>,
    /** Field contents, for saving */
    val username: String?,
    val password: String?,
) {
    val isEmpty: Boolean get() = usernameIds.isEmpty() && passwordIds.isEmpty()
    val allIds: List<AutofillId> get() = usernameIds + passwordIds
    val isBrowser: Boolean get() = packageName in Browsers.packages

    /**
     * The page being filled, if a trusted browser reported it. Any app can put any domain in its
     * views, so a domain from anything else (including an app's WebView) is ignored and the
     * request is treated as coming from that app.
     */
    val pageUrl: String?
        get() {
            if (!isBrowser || webDomain.isNullOrBlank()) return null
            val scheme = webScheme?.lowercase()?.takeIf { it == "http" || it == "https" } ?: "https"
            return "$scheme://${webDomain.trim().lowercase()}"
        }

    /** What the user sees as the form's origin: the site for browsers, else the app's package. */
    val displayOrigin: String get() = pageUrl?.substringAfter("://") ?: packageName
}

/** Finds username and password fields in an app's view structure. */
object FormParser {
    private val passwordWords = Regex("pass(word|wd|code|phrase)?|pwd|pin\\b|secret", RegexOption.IGNORE_CASE)
    private val usernameWords = Regex("user|e-?mail|login|account|identifier|phone|mobile", RegexOption.IGNORE_CASE)
    private val ignoreWords = Regex("search|captcha|otp|one-?time|2fa|totp|verification|(?<!pass)code\\b|promo|coupon|zip|postal", RegexOption.IGNORE_CASE)
    private val ignoredHtmlTypes = setOf("hidden", "submit", "button", "checkbox", "radio", "search", "file", "image", "reset", "range", "color", "date", "number")

    private enum class Kind { USERNAME, PASSWORD, TEXT, IGNORE }

    private class Field(val id: AutofillId, val kind: Kind, val value: String?)

    fun parse(structure: AssistStructure): LoginForm {
        val fields = mutableListOf<Field>()
        var domain: String? = null
        var scheme: String? = null
        var passwordDomain: String? = null
        var passwordScheme: String? = null

        fun visit(node: AssistStructure.ViewNode, inheritedDomain: String?, inheritedScheme: String?) {
            if (node.visibility != View.VISIBLE) return
            val nodeDomain = node.webDomain?.takeIf { it.isNotBlank() } ?: inheritedDomain
            val nodeScheme = node.webScheme?.takeIf { it.isNotBlank() } ?: inheritedScheme
            if (domain == null && nodeDomain != null) {
                domain = nodeDomain
                scheme = nodeScheme
            }
            val id = node.autofillId
            if (id != null && node.autofillType == View.AUTOFILL_TYPE_TEXT) {
                val kind = classify(node)
                if (kind != Kind.IGNORE) {
                    fields += Field(id, kind, node.autofillValue?.takeIf { it.isText }?.textValue?.toString())
                    if (kind == Kind.PASSWORD && passwordDomain == null) {
                        passwordDomain = nodeDomain
                        passwordScheme = nodeScheme
                    }
                }
            }
            for (i in 0 until node.childCount) visit(node.getChildAt(i), nodeDomain, nodeScheme)
        }

        for (i in 0 until structure.windowNodeCount) visit(structure.getWindowNodeAt(i).rootViewNode, null, null)

        val passwords = fields.filter { it.kind == Kind.PASSWORD }
        var usernames = fields.filter { it.kind == Kind.USERNAME }
        if (usernames.isEmpty() && passwords.isNotEmpty()) {
            // No labelled username: take the text field just before the first password field
            val firstPassword = fields.indexOfFirst { it.kind == Kind.PASSWORD }
            fields.subList(0, firstPassword).lastOrNull { it.kind == Kind.TEXT }?.let { usernames = listOf(it) }
        }
        return LoginForm(
            packageName = structure.activityComponent.packageName,
            webDomain = passwordDomain ?: domain,
            webScheme = if (passwordDomain != null) passwordScheme else scheme,
            usernameIds = usernames.map { it.id },
            passwordIds = passwords.map { it.id },
            username = usernames.firstNotNullOfOrNull { it.value?.takeIf(String::isNotEmpty) },
            password = passwords.firstNotNullOfOrNull { it.value?.takeIf(String::isNotEmpty) },
        )
    }

    private fun classify(node: AssistStructure.ViewNode): Kind {
        val hints = node.autofillHints.orEmpty().map { it.lowercase() }
        if (hints.any { "otp" in it || "one-time" in it || "sms" in it || "creditcard" in it || "postal" in it }) return Kind.IGNORE
        if (hints.any { "password" in it }) return Kind.PASSWORD
        if (hints.any { "username" in it || "email" in it }) return Kind.USERNAME

        val html = node.htmlInfo
        if (html != null) {
            if (!html.tag.equals("input", ignoreCase = true)) return Kind.IGNORE
            val attrs = html.attributes.orEmpty().associate { it.first.lowercase() to (it.second ?: "") }
            val type = attrs["type"]?.lowercase() ?: "text"
            val autocomplete = attrs["autocomplete"]?.lowercase() ?: ""
            if (type in ignoredHtmlTypes || "one-time-code" in autocomplete || "cc-" in autocomplete) return Kind.IGNORE
            if (type == "password" || "password" in autocomplete) return Kind.PASSWORD
            if (type == "email" || "username" in autocomplete || "email" in autocomplete) return Kind.USERNAME
            val label = listOf(attrs["name"], attrs["id"], attrs["placeholder"], attrs["aria-label"], node.hint)
                .filterNotNull().joinToString(" ")
            if (ignoreWords.containsMatchIn(label)) return Kind.IGNORE
            if (usernameWords.containsMatchIn(label)) return Kind.USERNAME
            return if (type == "text" || type == "tel") Kind.TEXT else Kind.IGNORE
        }

        val inputType = node.inputType
        val inputClass = inputType and InputType.TYPE_MASK_CLASS
        val variation = inputType and InputType.TYPE_MASK_VARIATION
        if (inputClass == InputType.TYPE_CLASS_TEXT && variation in setOf(
                InputType.TYPE_TEXT_VARIATION_PASSWORD,
                InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD,
                InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD,
            )
        ) return Kind.PASSWORD
        if (inputClass == InputType.TYPE_CLASS_NUMBER && variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD) return Kind.PASSWORD
        if (inputClass == InputType.TYPE_CLASS_TEXT && variation in setOf(
                InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS,
                InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS,
            )
        ) return Kind.USERNAME

        val label = listOfNotNull(node.idEntry, node.hint, node.contentDescription?.toString()).joinToString(" ")
        if (ignoreWords.containsMatchIn(label)) return Kind.IGNORE
        if (passwordWords.containsMatchIn(label)) return Kind.PASSWORD
        if (usernameWords.containsMatchIn(label)) return Kind.USERNAME
        val editable = inputClass == InputType.TYPE_CLASS_TEXT || node.className?.contains("EditText") == true
        return if (editable) Kind.TEXT else Kind.IGNORE
    }
}

/** Browsers whose reported page domain is trusted. */
object Browsers {
    val packages = setOf(
        "com.android.chrome", "com.chrome.beta", "com.chrome.dev", "com.chrome.canary", "org.chromium.chrome",
        "org.mozilla.firefox", "org.mozilla.firefox_beta", "org.mozilla.fenix", "org.mozilla.fennec_aurora",
        "org.mozilla.focus", "org.mozilla.klar", "org.mozilla.fennec_fdroid", "io.github.forkmaintainers.iceraven",
        "com.microsoft.emmx", "com.microsoft.emmx.beta", "com.microsoft.emmx.dev", "com.microsoft.emmx.canary",
        "com.brave.browser", "com.brave.browser_beta", "com.brave.browser_nightly",
        "com.vivaldi.browser", "com.vivaldi.browser.snapshot",
        "com.opera.browser", "com.opera.browser.beta", "com.opera.mini.native", "com.opera.gx",
        "com.sec.android.app.sbrowser", "com.sec.android.app.sbrowser.beta",
        "com.duckduckgo.mobile.android", "com.kiwibrowser.browser", "com.ecosia.android",
        "com.yandex.browser", "app.vanadium.browser", "org.bromite.bromite", "org.cromite.cromite",
        "com.mi.globalbrowser", "com.naver.whale", "com.cloudmosa.puffinFree", "mark.via.gp",
    )
}
