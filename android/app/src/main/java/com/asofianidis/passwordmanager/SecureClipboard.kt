package com.asofianidis.passwordmanager

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle

/** Copies secrets with the "sensitive" flag (hidden from clipboard previews) and clears them after a while. */
class SecureClipboard(context: Context, private val settings: AppSettings) {
    private val manager = context.getSystemService(ClipboardManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private var copiedSinceChange = false
    private var ignoreNextChange = false
    private val clear = Runnable {
        if (copiedSinceChange) manager.clearPrimaryClip()
        copiedSinceChange = false
    }

    init {
        // Only fires while we're in the foreground on Android 10+, which is when the user would
        // copy something else in this app; elsewhere the clear still runs on schedule.
        manager.addPrimaryClipChangedListener {
            if (ignoreNextChange) ignoreNextChange = false else copiedSinceChange = false
        }
    }

    fun copy(label: String, text: String, sensitive: Boolean = true) {
        val clip = ClipData.newPlainText(label, text)
        if (sensitive) {
            clip.description.extras = PersistableBundle().apply {
                putBoolean(if (Build.VERSION.SDK_INT >= 33) ClipDescription.EXTRA_IS_SENSITIVE else "android.content.extra.IS_SENSITIVE", true)
            }
        }
        ignoreNextChange = true
        manager.setPrimaryClip(clip)
        handler.removeCallbacks(clear)
        val seconds = settings.clipboardClearSeconds
        copiedSinceChange = sensitive && seconds > 0
        if (copiedSinceChange) handler.postDelayed(clear, seconds * 1000L)
    }
}
