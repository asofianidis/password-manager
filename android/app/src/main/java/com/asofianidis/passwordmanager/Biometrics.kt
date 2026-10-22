package com.asofianidis.passwordmanager

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.asofianidis.passwordmanager.vault.Crypto
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Biometric unlock. The vault key is encrypted with an Android Keystore key that can only be used
 * right after a strong biometric check, and that is destroyed if a new fingerprint or face is
 * enrolled. The master password still works, and is needed after the vault key changes (the
 * master password was changed or a device was revoked on the desktop).
 */
object Biometrics {
    private const val ALIAS = "pm-vault-key-wrap"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"

    fun available(context: Context): Boolean =
        BiometricManager.from(context).canAuthenticate(BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS

    fun enabled(context: Context): Boolean = context.pm.settings.biometric != null

    private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun createKey(): SecretKey {
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)
            .apply {
                if (Build.VERSION.SDK_INT >= 30) setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
            }
            .build()
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply { init(spec) }.generateKey()
    }

    /** Turns biometric unlock on: asks for a biometric, then stores the vault key under it. */
    fun enable(activity: FragmentActivity, onDone: (error: String?) -> Unit) {
        val vault = activity.pm.vault
        if (!vault.isUnlocked) return onDone("Unlock the vault first")
        keyStore().deleteEntry(ALIAS)
        val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, createKey()) }
        prompt(activity, "Turn on biometric unlock", cipher, onDone) { authorized ->
            val key = vault.key
            val ciphertext = authorized.doFinal(key)
            activity.pm.settings.biometric = BiometricBlob(
                iv = Crypto.b64encode(authorized.iv),
                ciphertext = Crypto.b64encode(ciphertext),
                keyId = vault.keyId,
            )
            onDone(null)
        }
    }

    fun disable(context: Context) {
        context.pm.settings.biometric = null
        runCatching { keyStore().deleteEntry(ALIAS) }
    }

    /**
     * Whether a biometric can unlock the vault right now. Turns biometric unlock off (with a
     * notice) when the vault key changed since it was set up.
     */
    fun canUnlock(context: Context): Boolean {
        val blob = context.pm.settings.biometric ?: return false
        val header = runCatching { context.pm.vault.keyHeader }.getOrNull() ?: return false
        if (header.keyId != null && header.keyId != blob.keyId) {
            disable(context)
            context.pm.settings.notice =
                "The master password changed, so biometric unlock was turned off. Turn it on again in Settings."
            return false
        }
        return available(context)
    }

    /** Unlocks the vault with a biometric. Calls back with null on success, else an error to show (or "" if cancelled). */
    fun unlock(activity: FragmentActivity, onDone: (error: String?) -> Unit) {
        val blob = activity.pm.settings.biometric ?: return onDone("Biometric unlock is off")
        val cipher = try {
            val key = keyStore().getKey(ALIAS, null) as? SecretKey ?: throw KeyPermanentlyInvalidatedException()
            Cipher.getInstance(TRANSFORMATION).apply {
                init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, Crypto.b64decode(blob.iv)))
            }
        } catch (e: KeyPermanentlyInvalidatedException) {
            disable(activity)
            return onDone("Your fingerprints or face changed, so biometric unlock was turned off. Use your master password.")
        }
        prompt(activity, "Unlock Password Manager", cipher, onDone) { authorized ->
            val key = authorized.doFinal(Crypto.b64decode(blob.ciphertext))
            try {
                val ok = activity.pm.vault.unlockWithKey(key)
                if (!ok) disable(activity)
                onDone(if (ok) null else "Biometric unlock no longer works for this vault. Use your master password.")
            } finally {
                key.fill(0)
            }
        }
    }

    private fun prompt(
        activity: FragmentActivity,
        title: String,
        cipher: Cipher,
        onDone: (String?) -> Unit,
        onAuthorized: (Cipher) -> Unit,
    ) {
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                val authorized = result.cryptoObject?.cipher ?: return onDone("Biometric check failed")
                try {
                    onAuthorized(authorized)
                } catch (e: Exception) {
                    onDone(e.message ?: "Biometric unlock failed")
                }
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                val cancelled = errorCode == BiometricPrompt.ERROR_USER_CANCELED ||
                    errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
                    errorCode == BiometricPrompt.ERROR_CANCELED
                onDone(if (cancelled) "" else errString.toString())
            }
        }
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setNegativeButtonText("Use master password")
            .setAllowedAuthenticators(BIOMETRIC_STRONG)
            .build()
        BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), callback)
            .authenticate(info, BiometricPrompt.CryptoObject(cipher))
    }
}
