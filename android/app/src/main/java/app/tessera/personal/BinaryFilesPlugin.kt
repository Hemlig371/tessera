package app.tessera.personal

import android.app.Activity
import android.content.Intent
import android.provider.DocumentsContract
import android.net.Uri
import android.util.Base64
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.concurrent.Executors

@CapacitorPlugin(name = "BinaryFiles")
class BinaryFilesPlugin : Plugin() {
    private val worker = Executors.newSingleThreadExecutor()
    private val store by lazy { BinaryStore(context.filesDir) }
    private var picking = false
    private fun id(call: PluginCall) = call.getString("id") ?: throw IllegalArgumentException()
    private fun long(call: PluginCall, key: String): Long {
        val value = call.data.getLong(key)
        if (value < 0 || value > 9007199254740991L) throw IllegalArgumentException()
        return value
    }
    private fun facts(value: BinaryStore.Facts?) = JSObject().put("facts", value?.let { JSObject().put("size", it.size).put("sha256", it.sha256) } ?: org.json.JSONObject.NULL)
    private fun reject(call: PluginCall, error: Exception) {
        val code = error.message
        call.reject((if (code in setOf("fileMissing", "fileExists", "fileCorrupt", "invalidId", "invalidFileChunk", "invalidFileOffset")) code else "fileError") ?: "fileError")
    }
    private fun work(call: PluginCall, action: () -> JSObject) {
        worker.execute { try { call.resolve(action()) } catch (error: Exception) { reject(call, error) } }
    }
    @PluginMethod fun begin(call: PluginCall) = work(call) { store.begin(id(call)); JSObject() }
    @PluginMethod fun write(call: PluginCall) = work(call) {
        val data = call.getString("data") ?: throw IllegalArgumentException()
        if (data.length > (BinaryStore.CHUNK_SIZE + 2) / 3 * 4) throw IllegalArgumentException()
        store.write(id(call), long(call, "offset"), Base64.decode(data, Base64.NO_WRAP)); JSObject()
    }
    @PluginMethod fun finish(call: PluginCall) = work(call) { facts(store.finish(id(call), long(call, "size"), call.getString("sha256"))) }
    @PluginMethod fun stat(call: PluginCall) = work(call) { JSObject().put("size", store.stat(id(call)) ?: org.json.JSONObject.NULL) }
    @PluginMethod fun inspect(call: PluginCall) = work(call) { facts(store.inspect(id(call))) }
    @PluginMethod fun read(call: PluginCall) = work(call) {
        val bytes = store.read(id(call), long(call, "offset"), call.getInt("length") ?: throw IllegalArgumentException())
        JSObject().put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
    }
    @PluginMethod fun remove(call: PluginCall) = work(call) { store.remove(id(call), call.getBoolean("staged") ?: false); JSObject() }
    @PluginMethod fun export(call: PluginCall) {
        if (picking) { call.reject("fileBusy"); return }
        picking = true
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE); type = call.getString("mime") ?: "application/octet-stream"
            putExtra(Intent.EXTRA_TITLE, call.getString("name") ?: "Tessera-file")
        }
        try { startActivityForResult(call, intent, "selected") }
        catch (error: Exception) { picking = false; reject(call, error) }
    }
    @ActivityCallback private fun selected(call: PluginCall?, result: ActivityResult) {
        picking = false
        if (call == null) return
        if (result.resultCode != Activity.RESULT_OK) { call.resolve(JSObject().put("saved", false)); return }
        val uri = result.data?.data
        worker.execute {
            try {
                if (uri == null) throw IllegalArgumentException()
                store.export(id(call), long(call, "size"), call.getString("sha256") ?: throw IllegalArgumentException()) {
                    context.contentResolver.openOutputStream(uri, "wt") ?: throw IllegalStateException()
                }
                call.resolve(JSObject().put("saved", true))
            } catch (error: Exception) {
                try { if (uri != null) DocumentsContract.deleteDocument(context.contentResolver, uri) } catch (_: Exception) { }
                reject(call, error)
            }
        }
    }

    /** One SAF folder picker, bounded selections. Existing user files are never silently overwritten. */
    @PluginMethod fun exportGroup(call: PluginCall) {
        if (picking) { call.reject("fileBusy"); return }
        val items = call.data.optJSONArray("files")
        if (items == null || items.length() !in 1..100) { call.reject("invalidAttachment"); return }
        picking = true
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        }
        try { startActivityForResult(call, intent, "folderSelected") }
        catch (_: Exception) { picking = false; call.reject("fileError") }
    }
    @ActivityCallback private fun folderSelected(call: PluginCall?, result: ActivityResult) {
        picking = false
        if (call == null) return
        if (result.resultCode != Activity.RESULT_OK) { call.resolve(JSObject().put("saved", false)); return }
        val tree = result.data?.data ?: return call.reject("fileError")
        worker.execute {
            val created = mutableListOf<Uri>()
            try {
                val root = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
                val paths = mutableMapOf<String, Uri>()
                val items = call.data.getJSONArray("files")
                val safe = Regex("^[^/\\\\\\u0000-\\u001f\\u007f]{1,120}$")
                val extension = Regex("^[a-f0-9]{64}$")
                fun folder(parent: Uri, part: String): Uri {
                    if (!safe.matches(part) || part == "." || part == "..") error("invalidAttachment")
                    val key = parent.toString() + "/" + part
                    return paths.getOrPut(key) {
                        val uri = DocumentsContract.createDocument(context.contentResolver, parent,
                            DocumentsContract.Document.MIME_TYPE_DIR, part) ?: error("fileError")
                        created.add(uri)
                        uri
                    }
                }
                var complete = 0
                for (index in 0 until items.length()) {
                    val file = items.getJSONObject(index)
                    val id = file.getString("id")
                    val sha = file.getString("sha256")
                    val size = file.getLong("size")
                    if (!extension.matches(sha) || size < 0L || size > 9007199254740991L) error("invalidAttachment")
                    val segments = file.getJSONArray("folders")
                    if (segments.length() !in 1..4) error("invalidAttachment")
                    var parent = root
                    for (j in 0 until segments.length()) parent = folder(parent, segments.getString(j))
                    val name = file.getString("name")
                    if (!safe.matches(name) || name == "." || name == "..") error("invalidAttachment")
                    val mime = file.getString("mime")
                    val uri = DocumentsContract.createDocument(context.contentResolver, parent, mime, name)
                        ?: error("fileError")
                    created.add(uri)
                    store.export(id, size, sha) {
                        context.contentResolver.openOutputStream(uri, "wt") ?: error("fileError")
                    }
                    complete++
                }
                call.resolve(JSObject().put("saved", true).put("count", complete))
            } catch (_: Exception) {
                // Delete only documents created by this operation, never pre-existing user files.
                for (uri in created.asReversed()) {
                    try { DocumentsContract.deleteDocument(context.contentResolver, uri) } catch (_: Exception) { }
                }
                call.reject("fileError")
            }
        }
    }
    override fun handleOnDestroy() { worker.shutdown() }
}
