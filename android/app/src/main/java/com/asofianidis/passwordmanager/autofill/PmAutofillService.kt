package com.asofianidis.passwordmanager.autofill

import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.SaveCallback
import android.service.autofill.SaveRequest
import android.util.Log
import com.asofianidis.passwordmanager.pm
import com.asofianidis.passwordmanager.vault.VaultState

/**
 * Android's autofill service: offers saved logins in apps and browsers, in the autofill dropdown
 * or the keyboard's suggestion strip, and offers to save logins the user types.
 */
class PmAutofillService : AutofillService() {
    override fun onFillRequest(request: FillRequest, cancellationSignal: CancellationSignal, callback: FillCallback) {
        try {
            val structure = request.fillContexts.last().structure
            val form = FormParser.parse(structure)
            if (form.isEmpty || form.packageName == packageName) return callback.onSuccess(null)

            val pm = applicationContext.pm
            pm.autoLock.checkExpired()
            val response = when (pm.vault.status.value.state) {
                VaultState.NO_VAULT -> null
                VaultState.LOCKED -> Responses.locked(this, form, request.inlineSuggestionsRequest)
                VaultState.UNLOCKED -> {
                    pm.autoLock.touch()
                    Responses.unlocked(this, form, request.inlineSuggestionsRequest)
                }
            }
            callback.onSuccess(response)
        } catch (e: Exception) {
            Log.e(TAG, "Fill request failed", e)
            callback.onSuccess(null)
        }
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        try {
            // A login can span screens (username first, then password), so look at all of them
            val forms = request.fillContexts.map { FormParser.parse(it.structure) }
            val last = forms.last()
            val password = forms.asReversed().firstNotNullOfOrNull { it.password }
            if (password.isNullOrEmpty() || last.packageName == packageName) return callback.onSuccess()
            val pending = PendingSave(
                packageName = last.packageName,
                pageUrl = forms.asReversed().firstNotNullOfOrNull { it.pageUrl },
                username = forms.asReversed().firstNotNullOfOrNull { it.username }.orEmpty(),
                password = password,
            )
            callback.onSuccess(AutofillActivity.saveIntentSender(this, PendingSave.put(pending)))
        } catch (e: Exception) {
            Log.e(TAG, "Save request failed", e)
            callback.onFailure("Password Manager couldn't save this login")
        }
    }

    companion object {
        private const val TAG = "PmAutofill"
    }
}

/** A login the user typed, waiting to be saved. Kept in memory and handed to the activity by token. */
data class PendingSave(val packageName: String, val pageUrl: String?, val username: String, val password: String) {
    companion object {
        private val pending = mutableMapOf<String, PendingSave>()

        @Synchronized
        fun put(save: PendingSave): String {
            val token = java.util.UUID.randomUUID().toString()
            pending.clear() // only the latest one matters
            pending[token] = save
            return token
        }

        /** Kept until [remove]d, so the activity can be recreated (e.g. on rotation) without losing it. */
        @Synchronized
        fun get(token: String?): PendingSave? = token?.let { pending[it] }

        @Synchronized
        fun remove(token: String?) {
            token?.let { pending.remove(it) }
        }
    }
}
