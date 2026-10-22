package com.asofianidis.passwordmanager

import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.core.content.ContextCompat
import com.asofianidis.passwordmanager.sync.SyncClient
import com.asofianidis.passwordmanager.vault.Vault
import com.asofianidis.passwordmanager.vault.VaultState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import java.io.File

class PmApp : Application() {
    lateinit var settings: AppSettings
        private set
    lateinit var vault: Vault
        private set
    lateinit var autoLock: AutoLock
        private set
    lateinit var sync: SyncManager
        private set
    lateinit var clipboard: SecureClipboard
        private set

    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun onCreate() {
        super.onCreate()
        instance = this
        settings = AppSettings(this)
        vault = Vault(File(noBackupFilesDir, "vault.json"))
        autoLock = AutoLock(this, vault, settings)
        sync = SyncManager(this, vault, settings, SyncClient(vault, { settings.deviceId }, { settings.deviceName }))
        clipboard = SecureClipboard(this, settings)

        // Start the auto-lock countdown whenever the vault is unlocked
        vault.status.drop(1).onEach { status ->
            if (status.state == VaultState.UNLOCKED) autoLock.touch()
        }.launchIn(scope)
    }

    companion object {
        lateinit var instance: PmApp
            private set
    }
}

val Context.pm: PmApp get() = applicationContext as PmApp

/**
 * Locks the vault after a period without use, and optionally when the screen turns off. The
 * deadline is checked against the elapsed-realtime clock, which keeps counting while the phone
 * sleeps; the timer alone would not.
 */
class AutoLock(context: Context, private val vault: Vault, private val settings: AppSettings) {
    private val handler = Handler(Looper.getMainLooper())
    @Volatile private var deadline = Long.MAX_VALUE
    @Volatile private var deadlineSession = -1L
    private val lockNow = Runnable { checkExpired() }

    init {
        ContextCompat.registerReceiver(
            context,
            object : BroadcastReceiver() {
                override fun onReceive(context: Context, intent: Intent) {
                    if (settings.lockOnScreenOff) vault.lock()
                }
            },
            IntentFilter(Intent.ACTION_SCREEN_OFF),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
    }

    /** Records activity, pushing the auto-lock deadline back. */
    fun touch() {
        if (checkExpired()) return
        handler.removeCallbacks(lockNow)
        val minutes = settings.autoLockMinutes
        if (minutes <= 0 || !vault.isUnlocked) {
            deadline = Long.MAX_VALUE
            return
        }
        val timeout = minutes * 60_000L
        deadlineSession = vault.sessionNumber
        deadline = SystemClock.elapsedRealtime() + timeout
        handler.postDelayed(lockNow, timeout)
    }

    /** Locks if this session's deadline has passed. Returns whether it did. */
    fun checkExpired(): Boolean {
        if (vault.isUnlocked && deadlineSession == vault.sessionNumber && SystemClock.elapsedRealtime() >= deadline) {
            vault.lock()
            deadline = Long.MAX_VALUE
            return true
        }
        return false
    }
}
