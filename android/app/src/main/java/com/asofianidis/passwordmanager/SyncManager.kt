package com.asofianidis.passwordmanager

import android.util.Log
import com.asofianidis.passwordmanager.sync.PeerException
import com.asofianidis.passwordmanager.sync.SyncClient
import com.asofianidis.passwordmanager.vault.Vault
import com.asofianidis.passwordmanager.vault.VaultState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

data class SyncState(val syncing: Boolean = false, val lastMessage: String? = null, val failed: Boolean = false)

/** Runs syncs with the paired desktops: on unlock, shortly after local edits, and on demand. */
class SyncManager(
    private val app: PmApp,
    private val vault: Vault,
    private val settings: AppSettings,
    val client: SyncClient,
) {
    private val _state = MutableStateFlow(SyncState())
    val state: StateFlow<SyncState> = _state.asStateFlow()
    private val mutex = Mutex()
    private var pending: Job? = null

    init {
        vault.status.distinctUntilChangedBy { it.state }.onEach {
            if (it.state == VaultState.UNLOCKED) syncSoon(0)
        }.launchIn(app.scope)
    }

    /** Syncs after a short delay, so a burst of edits becomes one sync. */
    fun syncSoon(delayMs: Long = 1500) {
        pending?.cancel()
        pending = app.scope.launch {
            delay(delayMs)
            try {
                Log.d(TAG, "Background sync: ${syncAll()}")
            } catch (e: Exception) {
                Log.w(TAG, "Background sync failed", e)
            }
        }
    }

    /** Syncs with every paired desktop. Returns a summary for the UI. */
    suspend fun syncAll(): String = mutex.withLock {
        val peers = settings.peers.value
        if (peers.isEmpty()) return "Add a computer to sync with first"
        if (!vault.isUnlocked) return "Unlock the vault to sync"
        _state.value = _state.value.copy(syncing = true)
        var received = 0
        val errors = mutableListOf<String>()
        withContext(Dispatchers.IO) {
            for (peer in peers) {
                try {
                    received += client.sync(peer.name, peer.host, peer.port).received
                    updatePeer(peer.id) { it.copy(lastSyncAt = System.currentTimeMillis(), lastError = null) }
                } catch (e: Exception) {
                    val message = describe(e)
                    errors += "${peer.name}: $message"
                    updatePeer(peer.id) { it.copy(lastError = message) }
                }
            }
        }
        val summary = when {
            errors.isNotEmpty() -> errors.joinToString("\n")
            received == 0 -> "Up to date"
            received == 1 -> "1 change received"
            else -> "$received changes received"
        }
        _state.value = SyncState(syncing = false, lastMessage = summary, failed = errors.isNotEmpty())
        summary
    }

    private fun updatePeer(id: String, change: (SyncPeer) -> SyncPeer) =
        settings.setPeers { peers -> peers.map { if (it.id == id) change(it) else it } }

    companion object {
        private const val TAG = "PmSync"

        fun describe(e: Exception): String = when {
            e is PeerException && e.status == 423 -> "The vault is locked on that computer. Unlock it there and try again."
            e is PeerException && e.status == 403 && e.message?.contains("removed") == true ->
                "This phone was removed from the vault. Pair it again."
            else -> e.message ?: e.javaClass.simpleName
        }
    }
}
