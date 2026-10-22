package com.asofianidis.passwordmanager.update

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.pm.PackageInfoCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import com.asofianidis.passwordmanager.AppSettings
import com.asofianidis.passwordmanager.MainActivity
import com.asofianidis.passwordmanager.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

data class UpdateState(
    /** A newer version, if the last check found one */
    val available: UpdateInfo? = null,
    val checking: Boolean = false,
    /** 0..1 while downloading */
    val progress: Float? = null,
    /** Handed to Android's installer; this process is replaced when it finishes */
    val installing: Boolean = false,
    val error: String? = null,
    val checkedAt: Long? = null,
) {
    val busy get() = checking || progress != null || installing
}

class UpdateException(message: String) : Exception(message)

/**
 * Updates the app from its GitHub releases: checks the release list, downloads the APK, checks it,
 * and hands it to Android's package installer. Android only accepts an APK signed with the same key
 * as the installed app, so a tampered download can't be installed even if it got this far.
 *
 * Once the user lets the app install apps, Android 12+ installs its own updates without asking (an
 * app updating itself may skip the confirmation). Older versions show a confirmation each time.
 */
class Updater(private val context: Context, private val settings: AppSettings) {
    private val _state = MutableStateFlow(UpdateState(available = currentAvailable(), checkedAt = settings.lastUpdateCheck.takeIf { it > 0 }))
    val state: StateFlow<UpdateState> = _state.asStateFlow()
    private val mutex = Mutex()

    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .callTimeout(5, TimeUnit.MINUTES)
        // GitHub redirects downloads to its CDN; never let a redirect drop to plain HTTP
        .followSslRedirects(false)
        .build()

    val currentVersionCode: Long = PackageInfoCompat.getLongVersionCode(context.packageManager.getPackageInfo(context.packageName, 0))

    /** Debug builds have their own package id and signing key; release APKs can't update them. */
    val supported get() = context.packageName == RELEASE_PACKAGE

    /** Whether the user let this app install apps (Settings → Install unknown apps). */
    val canInstall get() = context.packageManager.canRequestPackageInstalls()

    private val inForeground get() = ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)

    private fun currentAvailable() = settings.availableUpdate?.takeIf {
        it.versionCode > PackageInfoCompat.getLongVersionCode(context.packageManager.getPackageInfo(context.packageName, 0))
    }

    /** Checks GitHub for a newer version. Returns it, or null when up to date. */
    suspend fun check(): UpdateInfo? = mutex.withLock {
        _state.update { it.copy(checking = true, error = null) }
        try {
            val body = withContext(Dispatchers.IO) {
                val request = Request.Builder()
                    .url(ReleaseFeed.URL)
                    .header("Accept", "application/vnd.github+json")
                    .header("User-Agent", "password-manager-android")
                    .build()
                http.newCall(request).execute().use { res ->
                    if (!res.isSuccessful) throw UpdateException("GitHub answered ${res.code}")
                    res.body.string()
                }
            }
            val info = ReleaseFeed.newest(body, currentVersionCode)
            val now = System.currentTimeMillis()
            settings.lastUpdateCheck = now
            settings.availableUpdate = info
            _state.update { it.copy(available = info, checking = false, checkedAt = now) }
            Log.i(TAG, "Checked for updates: ${info?.version ?: "up to date"}")
            info
        } catch (e: Exception) {
            Log.w(TAG, "Update check failed", e)
            _state.update { it.copy(checking = false, error = describe(e)) }
            throw e
        }
    }

    /** Checks in the background if the last check was over an hour ago. */
    suspend fun checkIfDue() {
        if (!supported || !settings.updateChecks || _state.value.busy) return
        if (System.currentTimeMillis() - settings.lastUpdateCheck < 60 * 60_000L) return
        runCatching { check() }
    }

    /**
     * Downloads [info], checks it, and starts installing it. [interactive] means the user asked for
     * it in the app, so a confirmation screen can open right away; otherwise it becomes a notification.
     */
    suspend fun install(info: UpdateInfo, interactive: Boolean) = mutex.withLock {
        _state.update { it.copy(progress = 0f, error = null) }
        try {
            val apk = withContext(Dispatchers.IO) { download(info) }
            withContext(Dispatchers.IO) { verify(apk, info) }
            _state.update { it.copy(progress = null, installing = true) }
            withContext(Dispatchers.IO) { commit(apk, info, interactive) }
        } catch (e: Exception) {
            Log.w(TAG, "Update to ${info.version} failed", e)
            _state.update { it.copy(progress = null, installing = false, error = describe(e)) }
            throw e
        }
    }

    private fun download(info: UpdateInfo): File {
        val dir = File(context.cacheDir, "updates").apply { deleteRecursively(); mkdirs() }
        val file = File(dir, "password-manager-${info.version}.apk")
        val request = Request.Builder().url(info.apkUrl).header("User-Agent", "password-manager-android").build()
        http.newCall(request).execute().use { res ->
            if (!res.isSuccessful) throw UpdateException("The download failed (${res.code})")
            val total = res.body.contentLength().takeIf { it > 0 } ?: info.size
            if (total > MAX_APK_BYTES) throw UpdateException("The download is too large")
            val digest = MessageDigest.getInstance("SHA-256")
            var done = 0L
            res.body.byteStream().use { input ->
                file.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        done += n
                        if (done > MAX_APK_BYTES) throw UpdateException("The download is too large")
                        digest.update(buffer, 0, n)
                        output.write(buffer, 0, n)
                        if (total > 0) _state.update { it.copy(progress = (done.toFloat() / total).coerceAtMost(1f)) }
                    }
                }
            }
            if (info.size > 0 && done != info.size) throw UpdateException("The download was incomplete")
            val hex = digest.digest().joinToString("") { "%02x".format(it) }
            if (info.sha256 != null && hex != info.sha256) throw UpdateException("The download doesn't match the release")
        }
        return file
    }

    /** Checks the APK is this app, the expected version, and signed by the same key. */
    private fun verify(apk: File, info: UpdateInfo) {
        val pm = context.packageManager
        val archive = pm.getPackageArchiveInfo(apk.path, PackageManager.GET_SIGNING_CERTIFICATES)
            ?: throw UpdateException("The download isn't a valid app")
        if (archive.packageName != context.packageName) throw UpdateException("The download is a different app")
        if (PackageInfoCompat.getLongVersionCode(archive) != info.versionCode) throw UpdateException("The download is a different version")
        // Android checks the signature again when installing; this just fails early with a clear message
        val signers = archive.signingInfo?.apkContentsSigners
        if (signers != null && signers.any { !pm.hasSigningCertificate(context.packageName, it.toByteArray(), PackageManager.CERT_INPUT_RAW_X509) }) {
            throw UpdateException("The download isn't signed with this app's key")
        }
    }

    private fun commit(apk: File, info: UpdateInfo, interactive: Boolean) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            setSize(apk.length())
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            }
        }
        val id = installer.createSession(params)
        try {
            installer.openSession(id).use { session ->
                session.openWrite("base.apk", 0, apk.length()).use { out ->
                    apk.inputStream().use { it.copyTo(out) }
                    session.fsync(out)
                }
                settings.installingUpdate = info.version
                val intent = Intent(context, InstallReceiver::class.java)
                    .setAction(InstallReceiver.ACTION_STATUS)
                    .putExtra(InstallReceiver.EXTRA_VERSION, info.version)
                    .putExtra(InstallReceiver.EXTRA_INTERACTIVE, interactive)
                // Mutable: the installer adds the status extras
                val pending = PendingIntent.getBroadcast(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
                session.commit(pending.intentSender)
            }
            Log.i(TAG, "Installing ${info.version}")
        } catch (e: Exception) {
            runCatching { installer.abandonSession(id) }
            throw e
        } finally {
            apk.delete()
        }
    }

    /** Called with the installer's answer to [commit]. */
    internal fun onInstallStatus(intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val version = intent.getStringExtra(InstallReceiver.EXTRA_VERSION) ?: return
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
                if (intent.getBooleanExtra(InstallReceiver.EXTRA_INTERACTIVE, false) && inForeground) {
                    context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                } else {
                    notify(
                        "Update ready to install",
                        "Tap to install Password Manager $version",
                        PendingIntent.getActivity(context, 1, confirm, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE),
                    )
                }
                // The confirmation screen takes over; if it's dismissed, the user can start again
                _state.update { it.copy(installing = false) }
            }
            PackageInstaller.STATUS_SUCCESS -> Unit // This process is replaced; see onUpdated
            else -> {
                settings.installingUpdate = null
                val message = when (status) {
                    PackageInstaller.STATUS_FAILURE_ABORTED -> null // The user cancelled
                    PackageInstaller.STATUS_FAILURE_STORAGE -> "Not enough storage to install the update"
                    PackageInstaller.STATUS_FAILURE_CONFLICT, PackageInstaller.STATUS_FAILURE_INCOMPATIBLE ->
                        "This update can't replace the installed app"
                    else -> intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)?.let { "The update didn't install: $it" }
                        ?: "The update didn't install"
                }
                Log.w(TAG, "Install of $version ended with status $status: ${intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)}")
                _state.update { it.copy(installing = false, error = message) }
            }
        }
    }

    /** Runs in the new version after an update replaced the app. */
    internal fun onUpdated() {
        val version = settings.installingUpdate ?: return
        settings.installingUpdate = null
        settings.availableUpdate = null
        _state.update { it.copy(available = null, installing = false) }
        File(context.cacheDir, "updates").deleteRecursively()
        notify("Password Manager updated", "Now on version $version", openApp())
    }

    /** Posts "update available" once per version. */
    internal fun notifyAvailable(info: UpdateInfo) {
        if (settings.notifiedUpdate == info.version) return
        settings.notifiedUpdate = info.version
        notify("Update available", "Password Manager ${info.version} is ready to install", openApp())
    }

    private fun openApp() = PendingIntent.getActivity(
        context, 0,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun notify(title: String, text: String, tap: PendingIntent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "App updates", NotificationManager.IMPORTANCE_DEFAULT))
        val notification = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_autofill_key)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification) }
    }

    private fun describe(e: Exception) = when (e) {
        is UpdateException -> e.message
        is IOException -> "Couldn't reach GitHub"
        else -> e.message ?: "Something went wrong"
    }

    companion object {
        const val RELEASE_PACKAGE = "com.asofianidis.passwordmanager"
        private const val TAG = "PmUpdate"
        private const val CHANNEL = "updates"
        private const val NOTIFICATION_ID = 1
        private const val MAX_APK_BYTES = 200L * 1024 * 1024
    }
}
