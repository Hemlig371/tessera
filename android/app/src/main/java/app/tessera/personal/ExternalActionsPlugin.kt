package app.tessera.personal

import android.content.Intent
import android.content.Context
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.os.Build
import android.net.Uri
import android.provider.CalendarContract
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.JSObject
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "ExternalActions")
class ExternalActionsPlugin : Plugin() {
    companion object {
        private const val LIBRARY_ID = "tessera.library_id"
        private val idPattern = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
        @JvmStatic fun libraryIntent(context: Context, id: String): Intent {
            require(idPattern.matches(id))
            return Intent(context, MainActivity::class.java).setAction(context.packageName + ".OPEN_LIBRARY")
                .setData(Uri.parse("tessera-library://$id")).putExtra(LIBRARY_ID, id)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
    }
    private fun consumeLibraryIntent(intent: Intent) {
        if (intent.action != context.packageName + ".OPEN_LIBRARY") return
        val id = intent.getStringExtra(LIBRARY_ID)
        intent.removeExtra(LIBRARY_ID)
        if (id != null && idPattern.matches(id)) notifyListeners("openLibrary", JSObject().put("id", id), true)
    }
    private val sharePrefs by lazy { context.getSharedPreferences("incoming-shares", Context.MODE_PRIVATE) }
    private val shareKey = "items"
    private val shareIdKey = "tessera.share_id"

    /** Stage explicit text share privately before JS starts; never signal success before the core commits. */
    private fun captureShare(intent: Intent) {
        if (intent.action != Intent.ACTION_SEND || intent.type != "text/plain") return
        val id = intent.getStringExtra(shareIdKey) ?: UUID.randomUUID().toString().also { intent.putExtra(shareIdKey, it) }
        val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
        if (text.isNullOrEmpty() || text.length > 65536) {
            sharePrefs.edit().putString("error", "invalidSharedText").apply()
            notifyListeners("shareReceived", JSObject(), true)
            return
        }
        val array = JSONArray(sharePrefs.getString(shareKey, "[]"))
        for (i in 0 until array.length()) if (array.getJSONObject(i).optString("id") == id) return
        if (array.length() >= 32) {
            sharePrefs.edit().putString("error", "shareQueueFull").apply()
            notifyListeners("shareReceived", JSObject(), true)
            return
        }
        array.put(JSONObject().put("id", id).put("text", text))
        if (!sharePrefs.edit().putString(shareKey, array.toString()).commit()) {
            sharePrefs.edit().putString("error", "shareUnavailable").apply()
            notifyListeners("shareReceived", JSObject(), true)
            return
        }
        notifyListeners("shareReceived", JSObject(), true)
    }

    override fun load() {
        activity.intent?.let { consumeLibraryIntent(it); captureShare(it) }
    }
    override fun handleOnNewIntent(intent: Intent) {
        activity.setIntent(intent)
        consumeLibraryIntent(intent)
        captureShare(intent)
    }
    @PluginMethod fun pendingSharedText(call: PluginCall) {
        try {
            val array = JSONArray(sharePrefs.getString(shareKey, "[]"))
            val error = sharePrefs.getString("error", null)
            val result = JSObject().put("items", array)
            if (error != null) result.put("error", error)
            call.resolve(result)
        } catch (_: Exception) { call.reject("shareUnavailable") }
    }
    @PluginMethod fun ackSharedText(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("invalidId")
        try {
            val pending = JSONArray(sharePrefs.getString(shareKey, "[]"))
            val remaining = JSONArray()
            for (i in 0 until pending.length()) {
                val item = pending.getJSONObject(i)
                if (item.getString("id") != id) remaining.put(item)
            }
            if (!sharePrefs.edit().putString(shareKey, remaining.toString()).remove("error").commit())
                return call.reject("shareUnavailable")
            if (activity.intent?.getStringExtra(shareIdKey) == id) {
                activity.intent?.apply {
                    removeExtra(shareIdKey)
                    removeExtra(Intent.EXTRA_TEXT)
                    action = Intent.ACTION_MAIN
                }
            }
            call.resolve()
            // Return to the sending app only after the SQLite save has completed.
            if (remaining.length() == 0)
                activity.runOnUiThread { activity.finish() }
        } catch (_: Exception) { call.reject("shareUnavailable") }
    }
    @PluginMethod fun shortcutSupported(call: PluginCall) {
        val supported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            context.getSystemService(ShortcutManager::class.java)?.isRequestPinShortcutSupported == true
        call.resolve(JSObject().put("supported", supported))
    }
    @PluginMethod fun pinLibraryShortcut(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("invalidId")
        val name = call.getString("name")?.trim() ?: return call.reject("invalidName")
        if (!idPattern.matches(id) || name.isEmpty() || name.length > 200) { call.reject("invalidId"); return }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) { call.reject("shortcutUnavailable"); return }
        activity.runOnUiThread {
            try {
                val manager = context.getSystemService(ShortcutManager::class.java)
                if (manager?.isRequestPinShortcutSupported != true) { call.reject("shortcutUnavailable"); return@runOnUiThread }
                val shortName = name.substring(0, name.offsetByCodePoints(0, minOf(40, name.codePointCount(0, name.length))))
                val shortcut = ShortcutInfo.Builder(context, "library:$id").setShortLabel(shortName).setLongLabel(name)
                    .setIcon(Icon.createWithResource(context, R.mipmap.ic_launcher)).setIntent(libraryIntent(context, id)).build()
                call.resolve(JSObject().put("requested", manager.requestPinShortcut(shortcut, null)))
            } catch (_: Exception) { call.reject("shortcutUnavailable") }
        }
    }
    @PluginMethod fun openUrl(call: PluginCall) {
        val raw = call.getString("url") ?: return call.reject("invalidUrl")
        val uri = Uri.parse(raw)
        if (uri.scheme?.lowercase() !in setOf("http", "https", "mailto")) { call.reject("invalidUrl"); return }
        activity.runOnUiThread {
            try { activity.startActivity(Intent(Intent.ACTION_VIEW, uri)); call.resolve() }
            catch (_: Exception) { call.reject("externalOpenFailed") }
        }
    }
    @PluginMethod fun createCalendarEvent(call: PluginCall) {
        val title = call.getString("title")?.trim() ?: return call.reject("invalidCalendarEvent")
        val start = call.getLong("start") ?: return call.reject("invalidDate")
        val end = call.getLong("end") ?: return call.reject("invalidDate")
        val allDay = call.getBoolean("allDay") == true
        if (title.isEmpty() || title.length > 4096 || start < 0 || end <= start) { call.reject("invalidCalendarEvent"); return }
        activity.runOnUiThread {
            try {
                val intent = Intent(Intent.ACTION_INSERT).setData(CalendarContract.Events.CONTENT_URI)
                    .putExtra(CalendarContract.Events.TITLE, title)
                    .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, start)
                    .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end)
                    .putExtra(CalendarContract.Events.ALL_DAY, allDay)
                call.getString("description")?.let { intent.putExtra(CalendarContract.Events.DESCRIPTION, it) }
                call.getString("location")?.let { intent.putExtra(CalendarContract.Events.EVENT_LOCATION, it) }
                if (intent.resolveActivity(context.packageManager) == null) call.reject("calendarUnavailable")
                else { activity.startActivity(intent); call.resolve() }
            } catch (_: Exception) { call.reject("calendarUnavailable") }
        }
    }

    @PluginMethod fun createReminder(call: PluginCall) {
        val title = call.getString("title")?.trim() ?: return call.reject("invalidCalendarEvent")
        if (title.isEmpty() || title.length > 4096) { call.reject("invalidCalendarEvent"); return }
        activity.runOnUiThread {
            try {
                val intent = Intent("android.intent.action.CREATE_REMINDER")
                    .putExtra(Intent.EXTRA_TITLE, title)
                    .putExtra(Intent.EXTRA_TEXT, call.getString("description") ?: "")
                if (intent.resolveActivity(context.packageManager) == null) call.reject("reminderUnavailable")
                else { activity.startActivity(intent); call.resolve() }
            } catch (_: Exception) { call.reject("reminderUnavailable") }
        }
    }
}
