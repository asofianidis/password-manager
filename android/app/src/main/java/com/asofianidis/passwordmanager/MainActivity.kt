package com.asofianidis.passwordmanager

import android.os.Bundle
import android.view.View
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.asofianidis.passwordmanager.ui.HomeScreen
import com.asofianidis.passwordmanager.ui.LockedScreen
import com.asofianidis.passwordmanager.ui.PmTheme
import com.asofianidis.passwordmanager.ui.SetupScreen
import com.asofianidis.passwordmanager.vault.VaultState
import kotlinx.coroutines.launch

class MainActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Keep autofill services (including other password managers) away from the master password
        window.decorView.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        enableEdgeToEdge()
        setContent {
            PmTheme {
                val status by pm.vault.status.collectAsStateWithLifecycle()
                val settingsRevision by pm.settings.revision.collectAsStateWithLifecycle()
                LaunchedEffect(settingsRevision) {
                    if (pm.settings.blockScreenshots) {
                        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
                    } else {
                        window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                    }
                }
                when (status.state) {
                    VaultState.NO_VAULT -> SetupScreen()
                    VaultState.LOCKED -> LockedScreen()
                    VaultState.UNLOCKED -> HomeScreen(status)
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        pm.autoLock.checkExpired()
        pm.scope.launch { pm.updater.checkIfDue() }
    }

    override fun onUserInteraction() {
        super.onUserInteraction()
        pm.autoLock.touch()
    }
}
