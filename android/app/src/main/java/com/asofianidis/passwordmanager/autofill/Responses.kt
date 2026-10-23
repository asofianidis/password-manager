@file:Suppress("DEPRECATION") // Dataset.setValue: the Field-based replacement needs API 33

package com.asofianidis.passwordmanager.autofill

import android.app.PendingIntent
import android.app.slice.Slice
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.service.autofill.Dataset
import android.service.autofill.FillResponse
import android.service.autofill.InlinePresentation
import android.service.autofill.SaveInfo
import android.view.autofill.AutofillValue
import android.view.inputmethod.InlineSuggestionsRequest
import android.widget.RemoteViews
import android.widget.inline.InlinePresentationSpec
import androidx.autofill.inline.UiVersions
import androidx.autofill.inline.v1.InlineSuggestionUi
import com.asofianidis.passwordmanager.MainActivity
import com.asofianidis.passwordmanager.R
import com.asofianidis.passwordmanager.match.UrlMatch
import com.asofianidis.passwordmanager.pm
import com.asofianidis.passwordmanager.vault.VaultEntry

/** Builds the suggestions shown in the autofill dropdown and in the keyboard's suggestion strip. */
object Responses {
    /** Most logins offered directly; the rest are a search away. */
    private const val MAX_DATASETS = 6

    /** Logins that belong to the form's site or app, best first. */
    fun matches(context: Context, form: LoginForm): List<VaultEntry> {
        val entries = context.pm.vault.logins()
        val page = form.pageUrl
        return if (page != null) {
            UrlMatch.forPage(entries, page)
        } else {
            UrlMatch.forApp(entries, form.packageName, context.pm.settings.linkedEntries(form.packageName))
        }
    }

    /** The response while the vault is unlocked: matching logins, then "Search vault". */
    fun unlocked(context: Context, form: LoginForm, inline: InlineSuggestionsRequest?): FillResponse {
        val specs = InlineSpecs(context, inline)
        val builder = FillResponse.Builder()
        // Keep one inline slot for "Search vault"
        val limit = minOf(MAX_DATASETS, specs.max - 1).coerceAtLeast(0)
        val matches = matches(context, form).take(limit)
        matches.forEachIndexed { index, entry ->
            builder.addDataset(dataset(context, form, entry, specs.at(index, entryTitle(entry), entry.username.ifBlank { null })))
        }
        val searchSubtitle = if (matches.isEmpty()) "No saved login for ${form.displayOrigin}" else null
        builder.addDataset(
            authDataset(
                context, form,
                title = "Search vault…",
                subtitle = searchSubtitle,
                inline = specs.at(matches.size, "Search vault…", searchSubtitle),
                mode = AutofillActivity.MODE_PICK,
            ),
        )
        addSaveInfo(builder, form)
        return builder.build()
    }

    /** The response while the vault is locked: one item that unlocks and then fills. */
    fun locked(context: Context, form: LoginForm, inline: InlineSuggestionsRequest?): FillResponse {
        val specs = InlineSpecs(context, inline)
        val builder = FillResponse.Builder()
        builder.addDataset(
            authDataset(
                context, form,
                title = "Unlock to fill",
                subtitle = "Password Manager",
                inline = specs.at(0, "Unlock to fill", "Password Manager"),
                mode = AutofillActivity.MODE_UNLOCK,
            ),
        )
        addSaveInfo(builder, form)
        return builder.build()
    }

    /** A dataset that fills one login. */
    fun dataset(context: Context, form: LoginForm, entry: VaultEntry, inline: InlinePresentation? = null): Dataset {
        val title = entryTitle(entry)
        val subtitle = entry.username.ifBlank { null }
        val presentation = presentation(context, title, subtitle)
        val builder = Dataset.Builder(presentation)
        for (id in form.usernameIds) {
            if (Build.VERSION.SDK_INT >= 30 && inline != null) {
                builder.setValue(id, AutofillValue.forText(entry.username), presentation, inline)
            } else {
                builder.setValue(id, AutofillValue.forText(entry.username), presentation)
            }
        }
        for (id in form.passwordIds) {
            if (Build.VERSION.SDK_INT >= 30 && inline != null) {
                builder.setValue(id, AutofillValue.forText(entry.password), presentation, inline)
            } else {
                builder.setValue(id, AutofillValue.forText(entry.password), presentation)
            }
        }
        return builder.build()
    }

    private fun entryTitle(entry: VaultEntry) = entry.title.ifBlank { entry.url.ifBlank { "Untitled" } }

    /** A dataset that opens [AutofillActivity] instead of filling directly. */
    private fun authDataset(
        context: Context,
        form: LoginForm,
        title: String,
        subtitle: String?,
        inline: InlinePresentation?,
        mode: String,
    ): Dataset {
        val presentation = presentation(context, title, subtitle)
        val builder = Dataset.Builder(presentation)
        for (id in form.allIds) {
            if (Build.VERSION.SDK_INT >= 30 && inline != null) {
                builder.setValue(id, null, presentation, inline)
            } else {
                builder.setValue(id, null, presentation)
            }
        }
        builder.setAuthentication(AutofillActivity.intentSender(context, mode))
        return builder.build()
    }

    private fun addSaveInfo(builder: FillResponse.Builder, form: LoginForm) {
        if (form.passwordIds.isEmpty()) return
        val type = SaveInfo.SAVE_DATA_TYPE_PASSWORD or
            (if (form.usernameIds.isNotEmpty()) SaveInfo.SAVE_DATA_TYPE_USERNAME else 0)
        val save = SaveInfo.Builder(type, form.passwordIds.toTypedArray())
            // Web logins usually navigate rather than finish an activity
            .setFlags(SaveInfo.FLAG_SAVE_ON_ALL_VIEWS_INVISIBLE)
        if (form.usernameIds.isNotEmpty()) save.setOptionalIds(form.usernameIds.toTypedArray())
        builder.setSaveInfo(save.build())
    }

    private fun presentation(context: Context, title: String, subtitle: String?): RemoteViews =
        RemoteViews(context.packageName, R.layout.autofill_item).apply {
            setTextViewText(R.id.title, title)
            if (subtitle != null) {
                setTextViewText(R.id.subtitle, subtitle)
            } else {
                setViewVisibility(R.id.subtitle, android.view.View.GONE)
            }
        }

    /**
     * Keyboards that show suggestions inline (Gboard, Samsung Keyboard on Android 11+) say how
     * many they can show and how to style each one.
     */
    private class InlineSpecs(private val context: Context, private val request: InlineSuggestionsRequest?) {
        val max: Int = if (Build.VERSION.SDK_INT >= 30 && request != null) request.maxSuggestionCount else Int.MAX_VALUE

        fun at(index: Int, title: String, subtitle: String?): InlinePresentation? {
            if (Build.VERSION.SDK_INT < 30 || request == null || index >= max) return null
            val specs = request.inlinePresentationSpecs
            if (specs.isEmpty()) return null
            val spec: InlinePresentationSpec = specs[minOf(index, specs.size - 1)]
            if (!UiVersions.getVersions(spec.style).contains(UiVersions.INLINE_UI_VERSION_1)) return null
            val content = InlineSuggestionUi.newContentBuilder(attribution(context))
                .setTitle(title)
                .apply { if (subtitle != null) setSubtitle(subtitle) }
                .setStartIcon(Icon.createWithResource(context, R.drawable.ic_autofill_key))
                .setContentDescription(listOfNotNull(title, subtitle).joinToString(", "))
                .build()
            val slice: Slice = content.slice
            return InlinePresentation(slice, spec, false)
        }

        /** Opened when the user long-presses a suggestion: the app's main screen. */
        private fun attribution(context: Context): PendingIntent = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }
}
