package com.asofianidis.passwordmanager

import com.asofianidis.passwordmanager.match.UrlMatch
import com.asofianidis.passwordmanager.vault.EntryInput
import com.asofianidis.passwordmanager.vault.IncorrectPasswordException
import com.asofianidis.passwordmanager.vault.Vault
import com.asofianidis.passwordmanager.vault.VaultEntry
import com.asofianidis.passwordmanager.vault.VaultFile
import com.asofianidis.passwordmanager.vault.VaultJson
import com.asofianidis.passwordmanager.vault.VaultState
import com.asofianidis.passwordmanager.vault.canonicalJson
import com.asofianidis.passwordmanager.vault.pickNewer
import kotlinx.serialization.Serializable
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File
import java.nio.file.Files

/**
 * Checks the phone against fixtures written by the desktop app's own code
 * (android/scripts/fixtures.test.ts), so the two stay compatible.
 */
class InteropTest {
    @Serializable
    data class CanonicalCase(val entry: VaultEntry, val json: String)

    @Serializable
    data class TieCase(val a: VaultEntry, val b: VaultEntry, val winner: String)

    @Serializable
    data class MatchCase(val entryUrl: String, val pageUrl: String, val level: Int)

    @Serializable
    data class Fixtures(
        val password: String,
        val oldPassword: String,
        val vault: VaultFile,
        val oldVault: VaultFile,
        val canonical: List<CanonicalCase>,
        val ties: List<TieCase>,
        val matches: List<MatchCase>,
    )

    private val fixtures: Fixtures = VaultJson.decodeFromString(
        Fixtures.serializer(),
        javaClass.classLoader!!.getResource("interop.json")!!.readText(),
    )

    private fun vaultFile(contents: VaultFile = fixtures.vault): File {
        val dir = Files.createTempDirectory("pm-test").toFile()
        dir.deleteOnExit()
        return File(dir, "vault.json").apply {
            writeText(VaultJson.encodeToString(VaultFile.serializer(), contents))
        }
    }

    @Test
    fun adoptsAMasterPasswordChangeFromTheDesktop() {
        // A phone still on the old password syncs and receives the new header
        val vault = Vault(vaultFile(fixtures.oldVault))
        vault.unlock(fixtures.oldPassword)
        val oldKeyId = vault.keyId
        vault.applyRemote(emptyList(), fixtures.vault.key)
        assertTrue(vault.status.value.pendingKeyChange)
        assertEquals(oldKeyId, vault.keyId)

        try {
            vault.adoptPendingKey(fixtures.oldPassword)
            fail("the old password must not open the new header")
        } catch (e: IncorrectPasswordException) {
            // expected
        }
        vault.adoptPendingKey(fixtures.password)
        assertFalse(vault.status.value.pendingKeyChange)
        assertEquals(fixtures.vault.key.keyId, vault.keyId)
        assertEquals(1, vault.list().size)
    }

    @Test
    fun unlocksWithOnlyTheNewPasswordAfterReceivingTheNewHeader() {
        val file = vaultFile(fixtures.oldVault)
        Vault(file).apply {
            unlock(fixtures.oldPassword)
            applyRemote(emptyList(), fixtures.vault.key)
            lock()
        }
        // The data is still sealed with the old key; the new header's retired keys open it
        val vault = Vault(file)
        vault.unlock(fixtures.password)
        assertFalse(vault.status.value.pendingKeyChange)
        assertEquals(fixtures.vault.key.keyId, vault.keyId)
        assertEquals("hunter2", vault.list().single().password)
        // And the old password no longer works
        vault.lock()
        try {
            Vault(file).unlock(fixtures.oldPassword)
            fail("the old password must stop working once the new header is adopted")
        } catch (e: IncorrectPasswordException) {
            // expected
        }
    }

    @Test
    fun ignoresOlderOrWeakerHeaders() {
        val vault = Vault(vaultFile())
        vault.unlock(fixtures.password)
        vault.applyRemote(emptyList(), fixtures.oldVault.key)
        assertFalse("an older header is ignored", vault.status.value.pendingKeyChange)
        val weak = fixtures.vault.key.copy(updatedAt = Long.MAX_VALUE / 2, kdf = fixtures.vault.key.kdf.copy(memoryKiB = 1024))
        vault.applyRemote(emptyList(), weak)
        assertFalse("a header with a weak KDF is ignored", vault.status.value.pendingKeyChange)
    }

    @Test
    fun unlocksADesktopVaultAfterKeyRotation() {
        val file = vaultFile()
        val vault = Vault(file)
        assertEquals(VaultState.LOCKED, vault.status.value.state)
        try {
            vault.unlock(fixtures.oldPassword)
            fail("old password must not open the rotated vault")
        } catch (e: IncorrectPasswordException) {
            // expected
        }
        vault.unlock(fixtures.password)
        val live = vault.list()
        assertEquals(1, live.size)
        assertEquals("hunter2", live[0].password)
        assertEquals("line 1\nline \"2\"\t\\ é 🔑", live[0].notes)
        assertEquals(2, vault.allRecords().size)
        assertTrue(vault.allRecords().any { it.isDeleted })
        assertEquals(fixtures.vault.key.keyId, vault.keyId)
        assertEquals(1, vault.retiredKeys().size)

        // An edit made here re-seals the file so the desktop's format still reads it
        val updated = vault.updateEntry(live[0].id, EntryInput.of(live[0]).copy(password = "new pw"))
        vault.lock()
        val reopened = Vault(file)
        reopened.unlock(fixtures.password)
        assertEquals(updated, reopened.get(updated.id))
    }

    @Test
    fun unlocksWithTheVaultKeyForBiometrics() {
        val file = vaultFile()
        val vault = Vault(file)
        vault.unlock(fixtures.password)
        val key = vault.key.copyOf()
        vault.lock()
        assertFalse(vault.unlockWithKey(ByteArray(32)))
        assertTrue(vault.unlockWithKey(key))
        assertEquals(1, vault.list().size)
    }

    @Test
    fun canonicalJsonMatchesJavaScript() {
        for (case in fixtures.canonical) assertEquals(case.json, canonicalJson(case.entry))
        // The serializer used for sync writes keys in the same order. (It can't encode lone
        // surrogates, which only a corrupt entry would contain.)
        for (case in fixtures.canonical.filter { c -> c.entry.notes.none { it.isSurrogate() } }) {
            assertEquals(case.json, VaultJson.encodeToString(VaultEntry.serializer(), case.entry))
        }
    }

    @Test
    fun mergeTieBreakMatchesDesktop() {
        for (case in fixtures.ties) {
            val expected = if (case.winner == "a") case.a else case.b
            assertEquals(expected, pickNewer(case.a, case.b))
            assertEquals(expected, pickNewer(case.b, case.a))
        }
    }

    @Test
    fun urlMatchingMatchesDesktop() {
        val wrong = fixtures.matches.filter { UrlMatch.matchLevel(it.entryUrl, it.pageUrl) != it.level }
        assertTrue(
            wrong.joinToString("\n") { "${it.entryUrl} on ${it.pageUrl}: expected ${it.level}, got ${UrlMatch.matchLevel(it.entryUrl, it.pageUrl)}" },
            wrong.isEmpty(),
        )
    }

    @Test
    fun appLoginsMatchByPackage() {
        val entries = listOf(
            VaultEntry(id = "a", title = "GitHub", url = "androidapp://com.github.android"),
            VaultEntry(id = "b", title = "GitHub web", url = "https://github.com"),
            VaultEntry(id = "c", title = "Other", url = "https://example.com"),
        )
        assertEquals(listOf("a"), UrlMatch.forApp(entries, "com.github.android", emptySet()).map { it.id })
        assertEquals(listOf("a", "c"), UrlMatch.forApp(entries, "com.github.android", setOf("c")).map { it.id })
        val suggested = UrlMatch.suggestionsForApp(entries, "com.github.android").map { it.id }
        assertTrue("b" in suggested)
        assertFalse("c" in suggested)
        assertNotNull(UrlMatch.suggestionsForApp(entries, "com.example"))
    }
}
