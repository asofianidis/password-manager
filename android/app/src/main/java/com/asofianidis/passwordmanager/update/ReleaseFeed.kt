package com.asofianidis.passwordmanager.update

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/** A newer app version published on GitHub. */
@Serializable
data class UpdateInfo(
    val version: String,
    val versionCode: Long,
    val apkUrl: String,
    val size: Long,
    /** Lowercase hex SHA-256 of the APK, when GitHub reports one */
    val sha256: String? = null,
    val pageUrl: String,
)

@Serializable
internal data class GhRelease(
    @SerialName("tag_name") val tag: String = "",
    val draft: Boolean = false,
    val prerelease: Boolean = false,
    @SerialName("html_url") val pageUrl: String = "",
    val assets: List<GhAsset> = emptyList(),
)

@Serializable
internal data class GhAsset(
    val name: String,
    val size: Long = 0,
    @SerialName("browser_download_url") val url: String,
    /** "sha256:<hex>" */
    val digest: String? = null,
)

/**
 * Reads the repo's GitHub releases. Android builds ship in releases that aren't marked Latest (that
 * spot belongs to desktop builds), so this scans the list rather than asking for the latest one.
 */
object ReleaseFeed {
    const val URL = "https://api.github.com/repos/asofianidis/password-manager/releases?per_page=30"

    // Release builds only; CI names a debug build password-manager-<version>-debug.apk
    private val apkName = Regex("""^password-manager-(\d+)\.(\d+)\.(\d+)\.apk$""")
    private val sha256 = Regex("^sha256:([0-9a-f]{64})$")
    private val json = Json { ignoreUnknownKeys = true }

    /** Same scheme as versionCode in app/build.gradle.kts */
    fun versionCode(major: Int, minor: Int, patch: Int): Long = major * 10_000_000L + minor * 100_000L + patch

    /** The newest published APK above [currentCode], or null when this is the newest. */
    fun newest(body: String, currentCode: Long): UpdateInfo? =
        json.decodeFromString(ListSerializer(GhRelease.serializer()), body)
            .asSequence()
            .filter { !it.draft && !it.prerelease }
            .flatMap { release ->
                release.assets.asSequence().mapNotNull { asset ->
                    val (a, b, c) = apkName.matchEntire(asset.name)?.destructured ?: return@mapNotNull null
                    // Ignore an APK whose name disagrees with its release's tag
                    if (release.tag != "v$a.$b.$c" || !asset.url.startsWith("https://")) return@mapNotNull null
                    UpdateInfo(
                        version = "$a.$b.$c",
                        versionCode = versionCode(a.toInt(), b.toInt(), c.toInt()),
                        apkUrl = asset.url,
                        size = asset.size,
                        sha256 = asset.digest?.lowercase()?.let { sha256.matchEntire(it)?.groupValues?.get(1) },
                        pageUrl = release.pageUrl,
                    )
                }
            }
            .filter { it.versionCode > currentCode }
            .maxByOrNull { it.versionCode }
}
