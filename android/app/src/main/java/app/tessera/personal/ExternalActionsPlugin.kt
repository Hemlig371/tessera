package app.tessera.personal

import android.content.Intent
import android.net.Uri
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "ExternalActions")
class ExternalActionsPlugin : Plugin() {
    @PluginMethod fun openUrl(call: PluginCall) {
        val raw = call.getString("url") ?: return call.reject("invalidUrl")
        val uri = Uri.parse(raw)
        if (uri.scheme?.lowercase() !in setOf("http", "https", "mailto")) { call.reject("invalidUrl"); return }
        activity.runOnUiThread {
            try { activity.startActivity(Intent(Intent.ACTION_VIEW, uri)); call.resolve() }
            catch (_: Exception) { call.reject("externalOpenFailed") }
        }
    }
}
