package com.asofianidis.passwordmanager

import com.asofianidis.passwordmanager.update.ReleaseFeed
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ReleaseFeedTest {
    private fun asset(name: String, digest: String? = null) =
        """{"name":"$name","size":123,"browser_download_url":"https://github.com/x/$name"${digest?.let { ",\"digest\":\"$it\"" } ?: ""}}"""

    private fun release(tag: String, vararg assets: String, draft: Boolean = false, prerelease: Boolean = false) =
        """{"tag_name":"$tag","draft":$draft,"prerelease":$prerelease,"html_url":"https://github.com/r/$tag","assets":[${assets.joinToString(",")}],"body":"x"}"""

    private val current = ReleaseFeed.versionCode(1, 0, 16)

    @Test
    fun picksTheNewestReleaseApk() {
        val hex = "ab".repeat(32)
        val body = "[" + listOf(
            release("v1.0.19", asset("password-manager-1.0.19-x64-setup.exe")), // desktop only
            release("v1.0.18", asset("password-manager-1.0.18.apk", "sha256:$hex"), asset("password-manager-extension-1.0.18-chrome.zip")),
            release("v1.0.17", asset("password-manager-1.0.17.apk")),
        ).joinToString(",") + "]"
        val update = ReleaseFeed.newest(body, current)!!
        assertEquals("1.0.18", update.version)
        assertEquals(10_000_018L, update.versionCode)
        assertEquals(hex, update.sha256)
        assertEquals("https://github.com/x/password-manager-1.0.18.apk", update.apkUrl)
    }

    @Test
    fun comparesVersionsNumerically() {
        val body = "[" + release("v1.0.9", asset("password-manager-1.0.9.apk")) + "," +
            release("v1.2.0", asset("password-manager-1.2.0.apk")) + "]"
        assertEquals("1.2.0", ReleaseFeed.newest(body, ReleaseFeed.versionCode(1, 0, 9))!!.version)
        assertNull(ReleaseFeed.newest(body, ReleaseFeed.versionCode(1, 2, 0)))
    }

    @Test
    fun ignoresDebugDraftPrereleaseAndMismatchedApks() {
        val body = "[" + listOf(
            release("v1.0.20", asset("password-manager-1.0.20-debug.apk")),
            release("v1.0.21", asset("password-manager-1.0.21.apk"), draft = true),
            release("v1.0.22", asset("password-manager-1.0.22.apk"), prerelease = true),
            release("v1.0.15", asset("password-manager-1.0.23.apk")),
            release("v1.0.16", asset("password-manager-1.0.16.apk")),
        ).joinToString(",") + "]"
        assertNull(ReleaseFeed.newest(body, current))
    }

    @Test
    fun ignoresMalformedDigests() {
        val body = "[" + release("v1.0.17", asset("password-manager-1.0.17.apk", "sha512:abc")) + "]"
        assertNull(ReleaseFeed.newest(body, current)!!.sha256)
    }
}
