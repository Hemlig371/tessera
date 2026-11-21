package app.tessera.personal

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.util.UUID

/** Durable OS Share staging. URI permissions are used only while copying into private storage. */
internal class IncomingShareStore(private val context: Context) {
    private val prefs = context.getSharedPreferences("incoming-shares", Context.MODE_PRIVATE)
    private val root = File(context.filesDir, "share-staging")
    private val idPattern = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
    private fun valid(id: String) = idPattern.matches(id)
    private fun queue(): JSONArray = JSONArray(prefs.getString("items", "[]"))

    fun capture(intent: Intent) {
        if (intent.action !in setOf(Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE)) return
        val id = intent.getStringExtra("tessera.share_id") ?: UUID.randomUUID().toString().also {
            intent.putExtra("tessera.share_id", it)
        }
        if (!valid(id)) error("shareUnavailable")
        val current = queue()
        for (i in 0 until current.length()) if (current.getJSONObject(i).getString("id") == id) return
        if (current.length() >= 32) error("shareQueueFull")
        val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() ?: ""
        if (text.length > 65536) error("invalidSharedText")
        @Suppress("DEPRECATION")
        val uris: List<Uri> = when (intent.action) {
            Intent.ACTION_SEND_MULTIPLE -> intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.toList() ?: emptyList()
            else -> listOfNotNull(intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
        }
        if (uris.size > 16 || uris.any { it.scheme != "content" }) error("invalidSharedFile")
        if (text.isBlank() && uris.isEmpty()) error("invalidSharedText")
        val directory = File(root, id)
        if (directory.exists()) directory.deleteRecursively()
        val metadata = JSONArray()
        try {
            if (!directory.mkdirs()) error("shareUnavailable")
            for ((index, uri) in uris.withIndex()) {
                var display = "attachment-" + (index + 1)
                context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { result ->
                    if (result.moveToFirst()) display = result.getString(0) ?: display
                }
                display = display.substringAfterLast('/').substringAfterLast('\\')
                    .replace(Regex("[\\u0000-\\u001f\\u007f]"), "_").take(240)
                if (display.isBlank()) display = "attachment-" + (index + 1)
                val mime = context.contentResolver.getType(uri)?.take(255)
                    ?.takeIf { it.matches(Regex("^[a-zA-Z0-9!#$&^_.+-]+/[a-zA-Z0-9!#$&^_.+-]+$")) }
                    ?: "application/octet-stream"
                val temp = File(directory, "$index.part")
                val final = File(directory, "$index.bin")
                var size = 0L
                context.contentResolver.openInputStream(uri)?.use { input ->
                    FileOutputStream(temp).use { output ->
                        val buffer = ByteArray(256 * 1024)
                        while (true) {
                            val n = input.read(buffer)
                            if (n < 0) break
                            if (n == 0) continue
                            size += n
                            if (size > 2L * 1024 * 1024 * 1024) error("sharedFileTooLarge")
                            output.write(buffer, 0, n)
                        }
                        output.fd.sync()
                    }
                } ?: error("invalidSharedFile")
                if (!temp.renameTo(final)) error("shareUnavailable")
                metadata.put(JSONObject().put("index", index).put("name", display)
                    .put("mime", mime).put("size", size))
            }
            current.put(JSONObject().put("id", id).put("text", text).put("files", metadata))
            if (!prefs.edit().putString("items", current.toString()).remove("error").commit()) error("shareUnavailable")
        } catch (failure: Exception) {
            directory.deleteRecursively()
            throw failure
        }
    }
    data class Pending(val items: JSONArray, val error: String?)
    fun pending() = Pending(queue(), prefs.getString("error", null))
    fun report(error: String) { prefs.edit().putString("error", error).commit() }
    fun read(id: String, index: Int, offset: Long, length: Int): String {
        if (!valid(id) || index !in 0..15 || offset < 0 || length !in 1..262144) error("invalidSharedFile")
        val current = queue()
        var found = false
        for (i in 0 until current.length()) if (current.getJSONObject(i).getString("id") == id) {
            found = current.getJSONObject(i).getJSONArray("files").length() > index
            break
        }
        if (!found) error("invalidSharedFile")
        RandomAccessFile(File(File(root, id), "$index.bin"), "r").use { reader ->
            if (offset > reader.length() || offset + length > reader.length()) error("invalidSharedFile")
            reader.seek(offset)
            val bytes = ByteArray(length)
            reader.readFully(bytes)
            return Base64.encodeToString(bytes, Base64.NO_WRAP)
        }
    }
    fun acknowledge(id: String): Boolean {
        if (!valid(id)) error("invalidId")
        val current = queue()
        val remaining = JSONArray()
        var found = false
        for (i in 0 until current.length()) {
            val item = current.getJSONObject(i)
            if (item.getString("id") == id) found = true else remaining.put(item)
        }
        if (found && !prefs.edit().putString("items", remaining.toString()).remove("error").commit()) error("shareUnavailable")
        File(root, id).deleteRecursively()
        return found && remaining.length() == 0
    }
}
