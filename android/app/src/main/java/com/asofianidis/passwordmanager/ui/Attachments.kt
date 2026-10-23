package com.asofianidis.passwordmanager.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Download
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.asofianidis.passwordmanager.pm
import com.asofianidis.passwordmanager.vault.Attachment
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Attachments of a saved entry: image thumbnails (tap for full size) and files to save. */
@Composable
fun AttachmentsPanel(attachments: List<Attachment>) {
    if (attachments.isEmpty()) return
    val context = LocalContext.current
    val snackbar = LocalSnackbar.current
    val scope = rememberCoroutineScope()
    var saving by remember { mutableStateOf<Attachment?>(null) }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val attachment = saving ?: return@rememberLauncherForActivityResult
        saving = null
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val message = withContext(Dispatchers.IO) {
                runCatching {
                    val bytes = context.pm.vault.decryptAttachment(attachment) ?: return@runCatching "Not downloaded yet — sync to fetch it"
                    context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: error("Could not open the file")
                    "Saved ${attachment.name}"
                }.getOrElse { it.message ?: "Could not save the file" }
            }
            snackbar.showSnackbar(message)
        }
    }
    Panel {
        Column(Modifier.padding(vertical = 8.dp)) {
            Text("Files", color = Palette.muted, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 16.dp))
            attachments.forEachIndexed { index, attachment ->
                if (index > 0) HorizontalDivider(color = Palette.line)
                AttachmentRow(attachment) {
                    IconButton(onClick = {
                        saving = attachment
                        save.launch(attachment.name)
                    }) { Icon(Icons.Default.Download, contentDescription = "Save ${attachment.name}") }
                }
            }
        }
    }
}

/** Attachments in the editor: remove existing ones, add photos or any file. */
@Composable
fun AttachmentsEditor(attachments: List<Attachment>, onChange: (List<Attachment>) -> Unit) {
    val context = LocalContext.current
    val snackbar = LocalSnackbar.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }

    fun add(uri: Uri?) {
        if (uri == null) return
        if (attachments.size >= Attachment.MAX_PER_ENTRY) {
            scope.launch { snackbar.showSnackbar("An entry can have at most ${Attachment.MAX_PER_ENTRY} files") }
            return
        }
        busy = true
        scope.launch {
            val result = withContext(Dispatchers.IO) { runCatching { importFile(context, uri) } }
            busy = false
            result.onSuccess { onChange(attachments + it) }
                .onFailure { snackbar.showSnackbar(it.message ?: "Could not add the file") }
        }
    }

    val pickPhoto = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia(), ::add)
    val pickFile = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument(), ::add)

    Panel {
        Column(Modifier.padding(vertical = 8.dp)) {
            Text("Files", color = Palette.muted, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 16.dp))
            attachments.forEach { attachment ->
                AttachmentRow(attachment) {
                    IconButton(onClick = { onChange(attachments - attachment) }) {
                        Icon(Icons.Default.Close, contentDescription = "Remove ${attachment.name}")
                    }
                }
                HorizontalDivider(color = Palette.line)
            }
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            ) {
                OutlinedButton(enabled = !busy, onClick = {
                    pickPhoto.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                }) {
                    Icon(Icons.Default.AddPhotoAlternate, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Photo")
                }
                OutlinedButton(enabled = !busy, onClick = { pickFile.launch(arrayOf("*/*")) }) {
                    Icon(Icons.Default.AttachFile, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("File")
                }
                if (busy) CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
            }
        }
    }
}

/** Reads a picked file and stores it encrypted. Runs off the main thread. */
private fun importFile(context: Context, uri: Uri): Attachment {
    val resolver = context.contentResolver
    var name = "file"
    var size = -1L
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
            cursor.getString(0)?.let { name = it }
            if (!cursor.isNull(1)) size = cursor.getLong(1)
        }
    }
    val tooBig = "Files must be ${Attachment.MAX_BYTES / 1024 / 1024} MB or smaller"
    if (size > Attachment.MAX_BYTES) error(tooBig)
    val bytes = resolver.openInputStream(uri)?.use { input ->
        // Read one byte past the limit to catch sources that don't report a size
        val data = input.readNBytesCompat(Attachment.MAX_BYTES + 1)
        if (data.size > Attachment.MAX_BYTES) error(tooBig)
        data
    } ?: error("Could not read the file")
    val mime = resolver.getType(uri) ?: "application/octet-stream"
    return context.pm.vault.addAttachment(name, mime, bytes)
}

private fun java.io.InputStream.readNBytesCompat(limit: Int): ByteArray {
    val out = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(64 * 1024)
    while (out.size() < limit) {
        val read = read(buffer, 0, minOf(buffer.size, limit - out.size()))
        if (read < 0) break
        out.write(buffer, 0, read)
    }
    return out.toByteArray()
}

@Composable
private fun AttachmentRow(attachment: Attachment, actions: @Composable () -> Unit) {
    val context = LocalContext.current
    // null while loading; Missing when the file isn't on this device yet
    var thumb by remember(attachment.id) { mutableStateOf<Thumb?>(null) }
    var fullSize by remember { mutableStateOf(false) }
    LaunchedEffect(attachment.id) {
        thumb = withContext(Dispatchers.IO) {
            val bytes = runCatching { context.pm.vault.decryptAttachment(attachment) }.getOrNull()
            when {
                bytes == null -> Thumb.Missing
                attachment.isImage -> decodeScaled(bytes, 160)?.let { Thumb.Image(it) } ?: Thumb.File
                else -> Thumb.File
            }
        }
    }
    val current = thumb
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = current is Thumb.Image) { fullSize = true }
            .padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier.size(48.dp).clip(RoundedCornerShape(8.dp)).background(Palette.raised),
        ) {
            if (current is Thumb.Image) {
                Image(current.bitmap.asImageBitmap(), contentDescription = attachment.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            } else {
                Icon(Icons.AutoMirrored.Filled.InsertDriveFile, contentDescription = null, tint = Palette.muted)
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(attachment.name, color = Palette.bright, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                if (current is Thumb.Missing) "Not downloaded yet — sync to fetch" else formatSize(attachment.size),
                color = if (current is Thumb.Missing) Palette.warn else Palette.muted,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        actions()
    }
    if (fullSize) ImageDialog(attachment) { fullSize = false }
}

private sealed interface Thumb {
    class Image(val bitmap: Bitmap) : Thumb
    data object File : Thumb
    data object Missing : Thumb
}

@Composable
private fun ImageDialog(attachment: Attachment, onDismiss: () -> Unit) {
    val context = LocalContext.current
    var bitmap by remember { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(attachment.id) {
        bitmap = withContext(Dispatchers.IO) {
            runCatching { context.pm.vault.decryptAttachment(attachment)?.let { decodeScaled(it, 2048) } }.getOrNull()
        }
    }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color.Black).clickable(onClick = onDismiss),
        ) {
            val image = bitmap
            if (image == null) {
                CircularProgressIndicator()
            } else {
                Image(image.asImageBitmap(), contentDescription = attachment.name, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
            }
        }
    }
}

/** Decodes an image at no more than about [maxSide] pixels on its longer side. */
private fun decodeScaled(bytes: ByteArray, maxSide: Int): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
}

private fun formatSize(bytes: Long): String = when {
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> "${bytes / 1024} KB"
    else -> String.format(java.util.Locale.US, "%.1f MB", bytes / 1024.0 / 1024.0)
}
