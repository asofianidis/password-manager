package com.asofianidis.passwordmanager.update

import android.content.Context
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.asofianidis.passwordmanager.pm
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/**
 * Polls GitHub for a newer version every few hours. With automatic installs on, it installs the
 * update while the app is out of sight and the vault is locked, since installing restarts the app;
 * otherwise it posts a notification.
 */
class UpdateWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext.pm
        val updater = app.updater
        if (!updater.supported || !app.settings.updateChecks) return Result.success()
        val info = runCatching { updater.check() }.getOrElse { return Result.success() } ?: return Result.success()

        val inForeground = withContext(Dispatchers.Main) {
            ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
        }
        // The app shows its own banner while it's open
        if (inForeground) return Result.success()
        if (app.settings.updateInstall && updater.canInstall && !app.vault.isUnlocked) {
            if (runCatching { updater.install(info, interactive = false) }.isSuccess) return Result.success()
        }
        updater.notifyAvailable(info)
        return Result.success()
    }

    companion object {
        private const val NAME = "update-check"

        /** Starts or stops polling to match the setting. */
        fun schedule(context: Context) {
            val work = WorkManager.getInstance(context)
            if (!context.pm.updater.supported || !context.pm.settings.updateChecks) {
                work.cancelUniqueWork(NAME)
                return
            }
            val request = PeriodicWorkRequestBuilder<UpdateWorker>(6, TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            work.enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}
