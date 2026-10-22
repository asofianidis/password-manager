package com.asofianidis.passwordmanager.update

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.asofianidis.passwordmanager.pm

/** Receives the package installer's result, and runs once in the new version after an update. */
class InstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val updater = context.pm.updater
        when (intent.action) {
            ACTION_STATUS -> updater.onInstallStatus(intent)
            Intent.ACTION_MY_PACKAGE_REPLACED -> updater.onUpdated()
        }
    }

    companion object {
        const val ACTION_STATUS = "com.asofianidis.passwordmanager.UPDATE_STATUS"
        const val EXTRA_VERSION = "version"
        const val EXTRA_INTERACTIVE = "interactive"
    }
}
