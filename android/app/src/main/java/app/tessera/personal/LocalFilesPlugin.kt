package app.tessera.personal

import android.util.AtomicFile
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

/** Private file bytes and lifecycle only. Draft rules live in the shared TypeScript core. */
@CapacitorPlugin(name = "LocalFiles")
class LocalFilesPlugin : Plugin() {
    private val backCallback = object : androidx.activity.OnBackPressedCallback(false) {
        override fun handleOnBackPressed() { bridge.triggerWindowJSEvent("tessera-back") }
    }
    override fun load() {
        activity.runOnUiThread {
            val host = activity as androidx.activity.ComponentActivity
            host.onBackPressedDispatcher.addCallback(host, backCallback)
        }
    }
    @PluginMethod fun setBackHandling(call: PluginCall) {
        val enabled = call.getBoolean("enabled") ?: false
        activity.runOnUiThread { backCallback.isEnabled = enabled; call.resolve() }
    }
    private fun file(call: PluginCall): File {
        val path = call.getString("path") ?: throw IllegalArgumentException()
        if (path.isEmpty() || path.split('/').any { it.isEmpty() || it == "." || it == ".." || !it.matches(Regex("[A-Za-z0-9_.-]+")) }) throw IllegalArgumentException()
        val root = File(context.filesDir, "operational").canonicalFile
        val file = File(root, path).canonicalFile
        if (!file.path.startsWith(root.path + File.separator)) throw IllegalArgumentException()
        return file
    }
    @PluginMethod fun read(call: PluginCall) {
        try {
            val file = file(call)
            val target = AtomicFile(file)
            val bytes = try { target.openRead().use { it.readBytes() } } catch (error: java.io.FileNotFoundException) {
                if (file.exists() || File(file.path + ".bak").exists()) throw error
                null
            }
            call.resolve(JSObject().put("data", bytes?.let { Base64.encodeToString(it, Base64.NO_WRAP) } ?: org.json.JSONObject.NULL))
        } catch (_: Exception) { call.reject("fileError") }
    }
    @PluginMethod fun write(call: PluginCall) {
        try {
            val file = file(call)
            val bytes = Base64.decode(call.getString("data") ?: throw IllegalArgumentException(), Base64.DEFAULT)
            file.parentFile?.let { if (!it.isDirectory && !it.mkdirs()) throw IllegalStateException() }
            val target = AtomicFile(file)
            val stream = target.startWrite()
            try { stream.write(bytes); target.finishWrite(stream) }
            catch (error: Exception) { target.failWrite(stream); throw error }
            call.resolve()
        } catch (_: Exception) { call.reject("fileError") }
    }
    @PluginMethod fun remove(call: PluginCall) {
        try {
            val file = file(call)
            AtomicFile(file).delete()
            if (file.exists() || File(file.path + ".bak").exists() || File(file.path + ".new").exists()) throw IllegalStateException()
            call.resolve()
        } catch (_: Exception) { call.reject("fileError") }
    }
    override fun handleOnPause() { notifyListeners("state", JSObject().put("active", false)) }
    override fun handleOnResume() { notifyListeners("state", JSObject().put("active", true)) }
}
