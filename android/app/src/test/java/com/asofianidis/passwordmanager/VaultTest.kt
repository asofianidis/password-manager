package com.asofianidis.passwordmanager

import com.asofianidis.passwordmanager.vault.EntryInput
import com.asofianidis.passwordmanager.vault.VaultEntry
import com.asofianidis.passwordmanager.vault.mergeEntries
import com.asofianidis.passwordmanager.vault.toTombstone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VaultTest {
    @Test
    fun mergeKeepsNewestAndAddsNew() {
        val a = VaultEntry(id = "1", title = "old", updatedAt = 1)
        val b = VaultEntry(id = "1", title = "new", updatedAt = 2)
        val c = VaultEntry(id = "2", title = "other", updatedAt = 1)
        val result = mergeEntries(listOf(a), listOf(b, c))
        assertEquals(2, result.changed)
        assertEquals(setOf("new", "other"), result.entries.map { it.title }.toSet())
    }

    @Test
    fun tombstonesWinTies() {
        val live = VaultEntry(id = "1", title = "x", updatedAt = 5)
        val dead = toTombstone(live, 5)
        assertTrue(mergeEntries(listOf(live), listOf(dead)).entries.single().isDeleted)
        assertTrue(mergeEntries(listOf(dead), listOf(live)).entries.single().isDeleted)
        assertEquals("", dead.password)
    }

    @Test
    fun sanitizesInput() {
        val clean = EntryInput("  ", "u", "p", " https://x.com ", "", " ", " f ", false).sanitized()
        assertEquals("Untitled", clean.title)
        assertEquals("https://x.com", clean.url)
        assertEquals("f", clean.folder)
    }
}
