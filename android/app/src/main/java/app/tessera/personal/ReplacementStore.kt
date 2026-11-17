package app.tessera.personal

import android.os.StatFs
import android.system.Os
import android.system.OsConstants
import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Filesystem activation/recovery only. Shared TS owns the archive and database rules. */
internal class ReplacementStore(private val root: File, private val database: File) {
    companion object { private val gate = Any() }
    val stage get() = File(root, "operational/db-import/new")
    private val work get() = File(root, "operational/db-import")
    private val journal get() = AtomicFile(File(root, "operational/db-import-state.json"))
    private fun journalExists() = journal.baseFile.exists() || File(journal.baseFile.path + ".bak").exists()
    private fun plans(): List<Triple<File, File, File>> {
        val paths = listOf(database to "database.sqlite", File(database.path + "-wal") to "database.sqlite-wal", File(database.path + "-shm") to "database.sqlite-shm") +
            listOf("attachments" to "attachments", "operational/drafts" to "drafts", "operational/inbox" to "inbox",
                "operational/outbox" to "outbox", "cache/thumbnails" to "thumbnails", "operational/file-staging" to "file-staging").map { File(root, it.first) to it.second }
        return paths.map { Triple(it.first, File(stage, it.second), File(work, "old/" + it.second)) }
    }
    fun prepare(required: Long) = synchronized(gate) {
        recover(); check(File(root, "operational").isDirectory || File(root, "operational").mkdirs())
        remove(work)
        if (required < 0 || StatFs(root.path).availableBytes < required) error("notEnoughSpace")
        for (name in listOf("attachments", "drafts", "inbox", "outbox", "thumbnails", "file-staging", "operational/file-staging")) check(File(stage, name).mkdirs())
    }
    fun discard() = synchronized(gate) { if (journalExists()) error("fileBusy"); remove(work) }
    private fun hash(bytes: ByteArray) = java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
    private fun writeJournal(value: JSONObject) {
        val output = journal.startWrite()
        try {
            val payload = value.toString()
            val envelope = JSONObject().put("payload", payload).put("sha256", hash(payload.toByteArray(Charsets.UTF_8)))
            output.write(envelope.toString().toByteArray(Charsets.UTF_8)); journal.finishWrite(output)
        }
        catch (e: Exception) { journal.failWrite(output); throw e }
        sync(journal.baseFile.parentFile!!)
    }
    fun activate(hook: (String) -> Unit = {}) = synchronized(gate) {
        if (journalExists() || !File(stage, "database.sqlite").isFile) error("fileBusy")
        val plans = plans(); val existed = JSONArray(plans.map { it.first.exists() })
        check(File(work, "old").mkdirs())
        for ((_, staged, _) in plans) if (staged.isFile) java.io.FileOutputStream(staged, true).use { it.fd.sync() }
        sync(stage); writeJournal(JSONObject().put("committed", false).put("existed", existed)); hook("prepared")
        for ((index, plan) in plans.withIndex()) {
            val (active, staged, old) = plan
            if (active.exists()) check(active.renameTo(old))
            sync(active.parentFile!!); sync(old.parentFile!!); hook("old-$index")
            if (staged.exists()) { active.parentFile!!.mkdirs(); check(staged.renameTo(active)) }
            sync(active.parentFile!!); sync(stage); hook("new-$index")
        }
        writeJournal(JSONObject().put("committed", true).put("existed", existed)); hook("committed"); recover()
    }
    fun recover(): Unit = synchronized(gate) {
        if (!journalExists()) return@synchronized
        val value = try { journal.openRead().use {
            check(it.channel.size() <= 8192); val bytes = it.readBytes()
            val envelope = JSONObject(bytes.toString(Charsets.UTF_8)); val payload = envelope.getString("payload")
            check(envelope.getString("sha256") == hash(payload.toByteArray(Charsets.UTF_8))); JSONObject(payload)
        } } catch (_: Exception) { error("importRecoveryFailed") }
        val committed = value.getBoolean("committed"); val existed = value.getJSONArray("existed"); val plans = plans()
        check(existed.length() == plans.size)
        if (!committed) for ((index, plan) in plans.withIndex()) {
            val (active, _, old) = plan
            if (old.exists()) { remove(active); check(old.renameTo(active)) }
            else if (!existed.getBoolean(index)) remove(active)
            sync(active.parentFile!!)
        }
        remove(work); journal.delete(); check(!journalExists()); sync(journal.baseFile.parentFile!!)
    }
    private fun remove(file: File) { if (file.exists()) check(if (file.isDirectory) file.deleteRecursively() else file.delete()) }
    private fun sync(directory: File) {
        if (!directory.exists()) return
        check(directory.isDirectory)
        // O_DIRECTORY is not part of Android's public OsConstants API. These
        // private paths are directories; a read-only descriptor supports fsync.
        val fd = Os.open(directory.path, OsConstants.O_RDONLY, 0)
        try { Os.fsync(fd) } finally { Os.close(fd) }
    }
}
