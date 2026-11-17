package app.tessera.personal

import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

/** OS/files only. The normal bundled SQLite adapter opens the isolated temporary database. */
@CapacitorPlugin(name = "ImportFiles")
class ImportFilesPlugin : Plugin() {
    private val worker = Executors.newSingleThreadExecutor()
    private val replacement by lazy { ReplacementStore(context.filesDir, context.getDatabasePath("appSQLite.db")) }
    private val files by lazy { BinaryStore(replacement.stage) }
    private val nameFile get() = File(context.filesDir, "operational/db-import/database-name")
    private fun temporary(): File? {
        if (!nameFile.isFile) return null
        val name = nameFile.readText()
        check(name.matches(Regex("tesseraImport_[0-9a-f-]{36}")))
        return context.getDatabasePath(name + "SQLite.db")
    }
    private fun removeTemporary() {
        temporary()?.let { file -> for (suffix in listOf("", "-wal", "-shm")) { val part = File(file.path + suffix); if (part.exists()) check(part.delete()) } }
    }
    @PluginMethod fun invoke(call: PluginCall) {
        worker.execute {
            try {
                val args = call.getObject("args") ?: JSObject(); var value: Any = JSONObject.NULL
                when (call.getString("op")) {
                    "recover" -> { try { replacement.recover(); removeTemporary(); replacement.discard() } catch (_: Exception) { error("importRecoveryFailed") } }
                    "prepare" -> {
                        replacement.recover(); removeTemporary(); replacement.prepare(args.getLong("required"))
                        val name = "tesseraImport_" + UUID.randomUUID().toString()
                        java.io.FileOutputStream(nameFile).use { it.write(name.toByteArray()); it.fd.sync() }
                        value = JSObject().put("databaseName", name)
                    }
                    "abort" -> { removeTemporary(); replacement.discard() }
                    "seal" -> {
                        val file = temporary() ?: error("fileError")
                        // Both connections are closed by the shared queue before activation.
                        if (File(file.path + "-wal").let { it.exists() && it.length() > 0 }) error("fileBusy")
                        check(file.renameTo(File(replacement.stage, "database.sqlite")))
                        for (suffix in listOf("-wal", "-shm")) File(file.path + suffix).delete()
                    }
                    "activate" -> { try { replacement.activate() } catch (error: Exception) { replacement.recover(); throw error } }
                    "file_begin" -> files.begin(args.getString("id") ?: error("fileError"))
                    "file_write" -> {
                        val text = args.getString("data") ?: error("fileError"); check(text.length <= (BinaryStore.CHUNK_SIZE + 2) / 3 * 4)
                        files.write(args.getString("id") ?: error("fileError"), args.getLong("offset"), Base64.decode(text, Base64.NO_WRAP))
                    }
                    "file_finish" -> files.finish(args.getString("id") ?: error("fileError"), args.getLong("size"), args.getString("sha256") ?: error("fileError")).let { value = JSObject().put("size", it.size).put("sha256", it.sha256) }
                    else -> error("fileError")
                }
                call.resolve(JSObject().put("value", value))
            } catch (error: Exception) { call.reject(if (error.message in setOf("fileBusy", "notEnoughSpace", "fileCorrupt", "importRecoveryFailed")) error.message else "fileError") }
        }
    }
    override fun handleOnDestroy() { worker.shutdown() }
}
