package app.tessera.personal

import android.app.Activity
import android.content.Intent
import android.provider.DocumentsContract
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
    override fun handleOnDestroy() { worker.shutdown() }
}
