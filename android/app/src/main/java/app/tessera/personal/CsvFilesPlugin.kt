package app.tessera.personal

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.OutputStream

/** Storage Access Framework only; no database or CSV business logic. */
@CapacitorPlugin(name = "CsvFiles")
class CsvFilesPlugin : Plugin() {
    private var stream: OutputStream? = null
    private var uri: Uri? = null
    private var picking = false
    @PluginMethod fun begin(call: PluginCall) {
        if (picking || stream != null) { call.reject("fileBusy"); return }
        picking = true
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "text/csv"
            putExtra(Intent.EXTRA_TITLE, call.getString("name") ?: "Tessera.csv")
        }
        try { startActivityForResult(call, intent, "selected") }
        catch (_: Exception) { picking = false; call.reject("fileError") }
    }
    @ActivityCallback private fun selected(call: PluginCall?, result: ActivityResult) {
        picking = false
        if (call == null) return
        if (result.resultCode != Activity.RESULT_OK) { call.resolve(JSObject().put("cancelled", true)); return }
        try {
            val selected = result.data?.data ?: throw IllegalStateException()
            stream = context.contentResolver.openOutputStream(selected, "wt") ?: throw IllegalStateException()
            uri = selected
            call.resolve(JSObject().put("cancelled", false))
        } catch (_: Exception) { call.reject("fileError") }
    }
    @PluginMethod fun write(call: PluginCall) {
        try {
            val text = call.getString("text") ?: throw IllegalArgumentException()
            if (text.length > 32000) throw IllegalArgumentException()
            (stream ?: throw IllegalStateException()).write(text.toByteArray(Charsets.UTF_8))
            call.resolve()
        } catch (_: Exception) { call.reject("fileError") }
    }
    @PluginMethod fun finish(call: PluginCall) {
        try {
            val output = stream ?: throw IllegalStateException()
            output.flush(); output.close(); stream = null; uri = null; call.resolve()
        } catch (_: Exception) { call.reject("fileError") }
    }
    @PluginMethod fun abort(call: PluginCall) {
        try { stream?.close() } catch (_: Exception) { }
        stream = null
        try { uri?.let { android.provider.DocumentsContract.deleteDocument(context.contentResolver, it) } }
        catch (_: Exception) { }
        uri = null; call.resolve()
    }
    override fun handleOnDestroy() {
        try { stream?.close() } catch (_: Exception) { }
        stream = null
    }
}
