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
import java.io.File

/** Storage Access Framework only; no database or CSV business logic. */
@CapacitorPlugin(name = "CsvFiles")
class CsvFilesPlugin : Plugin() {
    private var staged: StagedCsv? = null
    private var uri: Uri? = null
    private var picking = false
    private val stagingDirectory get() = File(context.cacheDir, "csv-export")
    override fun load() { StagedCsv.removeInterrupted(stagingDirectory) }
    @PluginMethod fun begin(call: PluginCall) {
        if (picking || staged != null) { call.reject("fileBusy"); return }
        picking = true
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = call.getString("mime") ?: "text/csv"
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
            uri = selected
            staged = StagedCsv(stagingDirectory)
            call.resolve(JSObject().put("cancelled", false))
        } catch (_: Exception) { discard(); call.reject("fileError") }
    }
    @PluginMethod fun write(call: PluginCall) {
        try {
            val text = call.getString("text") ?: throw IllegalArgumentException()
            (staged ?: throw IllegalStateException()).write(text)
            call.resolve()
        } catch (_: Exception) { call.reject("fileError") }
    }
    @PluginMethod fun writeBytes(call: PluginCall) {
        try {
            val data = call.getString("data") ?: throw IllegalArgumentException()
            require(data.length <= (256 * 1024 + 2) / 3 * 4)
            (staged ?: throw IllegalStateException()).writeBytes(android.util.Base64.decode(data, android.util.Base64.NO_WRAP))
            call.resolve()
        } catch (_: Exception) { call.reject("fileError") }
    }
    @PluginMethod fun finish(call: PluginCall) {
        try {
            val selected = uri ?: throw IllegalStateException()
            (staged ?: throw IllegalStateException()).finish {
                context.contentResolver.openOutputStream(selected, "wt") ?: throw IllegalStateException()
            }
            staged = null; uri = null; call.resolve()
        } catch (_: Exception) { discard(); call.reject("fileError") }
    }
    private fun discard() {
        try { staged?.abort() } catch (_: Exception) { }
        staged = null
        try { uri?.let { android.provider.DocumentsContract.deleteDocument(context.contentResolver, it) } }
        catch (_: Exception) { }
        uri = null
    }
    @PluginMethod fun abort(call: PluginCall) { discard(); call.resolve() }
    override fun handleOnDestroy() { discard() }
}
