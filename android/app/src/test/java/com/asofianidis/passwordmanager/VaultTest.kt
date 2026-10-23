package com.asofianidis.passwordmanager

import com.asofianidis.passwordmanager.vault.Attachment
import com.asofianidis.passwordmanager.vault.CardDetails
import com.asofianidis.passwordmanager.vault.EntryInput
import com.asofianidis.passwordmanager.vault.EntryType
import com.asofianidis.passwordmanager.vault.IdentityDetails
import com.asofianidis.passwordmanager.vault.VaultEntry
import com.asofianidis.passwordmanager.vault.VaultJson
import com.asofianidis.passwordmanager.vault.canonicalJson
import com.asofianidis.passwordmanager.vault.cardBrand
import com.asofianidis.passwordmanager.vault.formatCardNumber
import com.asofianidis.passwordmanager.vault.mergeEntries
import com.asofianidis.passwordmanager.vault.toTombstone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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

    @Test
    fun composesOnlyTheFieldsATypeUses() {
        val input = EntryInput.empty(EntryType.CARD).copy(
            title = "Visa",
            card = CardDetails(" Jane ", "4242 4242-4242 4242", "08/27", "123", ""),
            identity = IdentityDetails(fullName = "ignored"),
        ).sanitized()
        val card = input.compose("1", 1, 2, 3)
        assertEquals("card", card.type)
        assertEquals("Jane", card.card?.cardholder)
        assertEquals("4242424242424242", card.card?.number)
        assertNull(card.identity)
        assertNull("no attachments key when there are none", card.attachments)
        assertEquals(
            "{\"id\":\"1\",\"title\":\"Visa\",\"username\":\"\",\"password\":\"\",\"url\":\"\",\"notes\":\"\",\"totp\":\"\"," +
                "\"folder\":\"\",\"favorite\":false,\"createdAt\":1,\"updatedAt\":2,\"passwordUpdatedAt\":3,\"type\":\"card\"," +
                "\"card\":{\"cardholder\":\"Jane\",\"number\":\"4242424242424242\",\"expiry\":\"08/27\",\"cvv\":\"123\",\"pin\":\"\"}}",
            canonicalJson(card),
        )
        assertEquals(canonicalJson(card), VaultJson.encodeToString(VaultEntry.serializer(), card))

        val login = EntryInput("GitHub", "u", "p", "", "", "", "", false).sanitized().compose("2", 1, 1, 1)
        assertNull(login.type)
        assertTrue(login.isLogin)
        assertEquals(VaultJson.encodeToString(VaultEntry.serializer(), login), canonicalJson(login))
    }

    @Test
    fun cleansIdentitiesAndAttachments() {
        val identity = IdentityDetails(kind = "library-card", fullName = " Jane ").sanitized()
        assertEquals("other", identity.kind)
        assertEquals("Jane", identity.fullName)
        val ok = Attachment("abcdefgh-1", " a.jpg ", "image/jpeg", 5, "k")
        val cleaned = Attachment.clean(listOf(ok, ok.copy(name = "dup"), Attachment("../evil", key = "k"), Attachment("short", key = "k")))
        assertEquals(listOf(ok.copy(name = "a.jpg")), cleaned)
        assertEquals(20, Attachment.clean((1..25).map { ok.copy(id = "attachment-$it") }).size)
    }

    @Test
    fun tombstonesOfTypedEntriesCarryNothing() {
        val doc = EntryInput.empty(EntryType.DOCUMENT).copy(
            title = "Lease",
            attachments = listOf(Attachment("abcdefgh-1", key = "secret")),
        ).sanitized().compose("1", 1, 1, 1)
        val dead = toTombstone(doc, 2)
        assertNull(dead.type)
        assertNull(dead.attachments)
        assertEquals("{\"id\":\"1\",\"title\":\"\",\"username\":\"\",\"password\":\"\",\"url\":\"\",\"notes\":\"\",\"totp\":\"\"," +
            "\"folder\":\"\",\"favorite\":false,\"createdAt\":1,\"updatedAt\":2,\"passwordUpdatedAt\":1,\"deleted\":true}", canonicalJson(dead))
    }

    @Test
    fun describesCards() {
        assertEquals("Visa", cardBrand("4111"))
        assertEquals("American Express", cardBrand("378282246310005"))
        assertEquals("Mastercard", cardBrand("2221000000000009"))
        assertNull(cardBrand("9999"))
        assertEquals("3782 822463 10005", formatCardNumber("378282246310005"))
        assertEquals("4242 4242 4242 4242", formatCardNumber("4242424242424242"))
    }
}
