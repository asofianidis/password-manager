package com.asofianidis.passwordmanager.vault

import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import java.security.SecureRandom
import java.text.Normalizer
import java.util.Base64
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Crypto primitives, byte-compatible with src/main/vault/crypto.ts in the desktop app. */
object Crypto {
    private const val IV_LENGTH = 12
    private const val TAG_BITS = 128
    private const val TAG_LENGTH = TAG_BITS / 8

    val random = SecureRandom()

    fun randomBytes(size: Int): ByteArray = ByteArray(size).also { random.nextBytes(it) }

    /** The weakest KDF settings accepted from another device (see KDF_LIMITS on desktop). */
    private const val MIN_MEMORY_KIB = 64 * 1024
    private const val MAX_MEMORY_KIB = 1024 * 1024
    private const val MIN_ITERATIONS = 3
    private const val MAX_ITERATIONS = 64
    private const val MAX_PARALLELISM = 16
    private const val MIN_SALT_BYTES = 16

    fun isAcceptableKdf(kdf: KdfParams): Boolean {
        if (kdf.algorithm != "argon2id") return false
        val salt = runCatching { b64decode(kdf.salt) }.getOrNull() ?: return false
        return salt.size >= MIN_SALT_BYTES &&
            kdf.memoryKiB in MIN_MEMORY_KIB..MAX_MEMORY_KIB &&
            kdf.iterations in MIN_ITERATIONS..MAX_ITERATIONS &&
            kdf.parallelism in 1..MAX_PARALLELISM
    }

    /** Argon2id over the UTF-8 of the NFKC-normalized password, 32-byte output. */
    fun deriveKey(password: String, kdf: KdfParams): ByteArray {
        require(kdf.algorithm == "argon2id") { "Unsupported KDF: ${kdf.algorithm}" }
        val params = Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
            .withVersion(Argon2Parameters.ARGON2_VERSION_13)
            .withSalt(b64decode(kdf.salt))
            .withMemoryAsKB(kdf.memoryKiB)
            .withIterations(kdf.iterations)
            .withParallelism(kdf.parallelism)
            .build()
        val generator = Argon2BytesGenerator().apply { init(params) }
        val passwordBytes = Normalizer.normalize(password, Normalizer.Form.NFKC).toByteArray(Charsets.UTF_8)
        val out = ByteArray(32)
        try {
            generator.generateBytes(passwordBytes, out)
        } finally {
            passwordBytes.fill(0)
        }
        return out
    }

    /** AES-256-GCM. Output is base64(iv || ciphertext || tag). */
    fun seal(key: ByteArray, plaintext: ByteArray, aad: String): String {
        val iv = randomBytes(IV_LENGTH)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, iv))
        cipher.updateAAD(aad.toByteArray(Charsets.UTF_8))
        return b64encode(iv + cipher.doFinal(plaintext))
    }

    fun open(key: ByteArray, sealed: String, aad: String): ByteArray {
        val raw = runCatching { b64decode(sealed) }.getOrNull() ?: throw DecryptionException()
        if (raw.size < IV_LENGTH + TAG_LENGTH) throw DecryptionException()
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
                Cipher.DECRYPT_MODE,
                SecretKeySpec(key, "AES"),
                GCMParameterSpec(TAG_BITS, raw, 0, IV_LENGTH),
            )
            cipher.updateAAD(aad.toByteArray(Charsets.UTF_8))
            return cipher.doFinal(raw, IV_LENGTH, raw.size - IV_LENGTH)
        } catch (e: AEADBadTagException) {
            throw DecryptionException()
        } catch (e: java.security.GeneralSecurityException) {
            throw DecryptionException()
        }
    }

    fun sealString(key: ByteArray, value: String, aad: String): String =
        seal(key, value.toByteArray(Charsets.UTF_8), aad)

    fun openString(key: ByteArray, sealed: String, aad: String): String =
        open(key, sealed, aad).toString(Charsets.UTF_8)

    /** base64url(HMAC-SHA256(key, "pm:key-id:v1")), first 22 characters. */
    fun keyIdOf(key: ByteArray): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        val digest = mac.doFinal("pm:key-id:v1".toByteArray(Charsets.UTF_8))
        return Base64.getUrlEncoder().withoutPadding().encodeToString(digest).take(22)
    }

    /** 18 random bytes as base64url, as the desktop uses for sync nonces. */
    fun nonce(): String = Base64.getUrlEncoder().withoutPadding().encodeToString(randomBytes(18))

    fun b64encode(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)
    fun b64decode(value: String): ByteArray = Base64.getDecoder().decode(value)
}

class DecryptionException : Exception("Decryption failed")

/** Associated-data labels. Must match AAD in src/main/vault/crypto.ts. */
object Aad {
    fun vaultKey(vaultId: String) = "pm:vault-key:v1:$vaultId"
    fun vaultData(vaultId: String) = "pm:vault-data:v1:$vaultId"
    fun previousKey(vaultId: String, keyId: String, revoked: Boolean) =
        "pm:prev-key:v1:$vaultId:$keyId:${if (revoked) "revoked" else "forward"}"
    fun syncRequest(vaultId: String) = "pm:sync-req:v1:$vaultId"
    fun syncResponse(vaultId: String, nonce: String) = "pm:sync-res:v1:$vaultId:$nonce"
}
