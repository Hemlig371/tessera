package app.tessera.personal

import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream
import java.io.RandomAccessFile
import java.security.MessageDigest

/** File bytes only. No database, attachment ownership, retention or synchronization rules. */
class BinaryStore(private val root: File) {
    companion object {
        const val CHUNK_SIZE = 256 * 1024
        // Activity recreation can briefly overlap old and new plugin workers.
        private val ioLock = Any()
    }
    private fun <T> locked(action: () -> T): T = synchronized(ioLock, action)
    data class Facts(val size: Long, val sha256: String)
    private fun fail(code: String): Nothing = throw IllegalStateException(code)
    private fun path(id: String, staged: Boolean): File {
        if (!id.matches(Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"))) fail("invalidId")
        val base = root.canonicalFile
        val relative = if (staged) "operational/file-staging/$id.part" else "attachments/${id.take(2)}/$id"
        val file = File(base, relative)
        if (file.canonicalPath != file.absolutePath || !file.canonicalPath.startsWith(base.path + File.separator)) fail("fileError")
        return file
    }
    private fun hash(file: File): Facts? {
        if (!file.exists()) return null
        val digest = MessageDigest.getInstance("SHA-256")
        var size = 0L
        file.inputStream().use { input ->
            val buffer = ByteArray(CHUNK_SIZE)
            while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count); size += count }
        }
        return Facts(size, digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) })
    }
    fun begin(id: String): Unit = locked {
        val staged = path(id, true)
        if (path(id, false).exists()) fail("fileExists")
        if (staged.parentFile?.isDirectory != true && staged.parentFile?.mkdirs() != true) fail("fileError")
        if (!staged.createNewFile()) fail("fileExists")
    }
    fun write(id: String, offset: Long, bytes: ByteArray): Unit = locked {
        if (bytes.isEmpty() || bytes.size > CHUNK_SIZE) fail("invalidFileChunk")
        val staged = path(id, true)
        if (!staged.isFile) fail("fileMissing")
        if (offset < 0 || staged.length() != offset) fail("invalidFileOffset")
        FileOutputStream(staged, true).use { it.write(bytes) }
    }
    fun finish(id: String, size: Long, sha256: String?): Facts = locked {
        val staged = path(id, true); val target = path(id, false)
        val facts = hash(staged) ?: fail("fileMissing")
        if (facts.size != size || (sha256 != null && facts.sha256 != sha256)) fail("fileCorrupt")
        if (target.exists()) fail("fileExists")
        FileOutputStream(staged, true).use { it.fd.sync() }
        if (target.parentFile?.isDirectory != true && target.parentFile?.mkdirs() != true) fail("fileError")
        if (!staged.renameTo(target)) fail("fileError")
        val fd = android.system.Os.open(target.parentFile!!.path, android.system.OsConstants.O_RDONLY, 0)
        try { android.system.Os.fsync(fd) } finally { android.system.Os.close(fd) }
        facts
    }
    fun stat(id: String): Long? = locked { val file = path(id, false); if (file.isFile) file.length() else if (!file.exists()) null else fail("fileError") }
    fun inspect(id: String): Facts? = locked { hash(path(id, false)) }
    fun read(id: String, offset: Long, length: Int): ByteArray = locked {
        if (length < 1 || length > CHUNK_SIZE) fail("invalidFileChunk")
        val file = path(id, false)
        if (!file.isFile) fail("fileMissing")
        if (offset < 0 || offset > file.length()) fail("invalidFileOffset")
        RandomAccessFile(file, "r").use { input ->
            input.seek(offset)
            val bytes = ByteArray(minOf(length.toLong(), file.length() - offset).toInt())
            input.readFully(bytes); bytes
        }
    }
    fun remove(id: String, staged: Boolean): Unit = locked {
        val file = path(id, staged)
        if (file.exists() && !file.delete()) fail("fileError")
    }
    fun export(id: String, size: Long, sha256: String, destination: () -> OutputStream): Unit = locked {
        val file = path(id, false)
        if (hash(file) != Facts(size, sha256)) fail("fileCorrupt")
        val digest = MessageDigest.getInstance("SHA-256"); var copied = 0L
        destination().use { output ->
            file.inputStream().use { input ->
                val buffer = ByteArray(CHUNK_SIZE)
                while (true) { val n = input.read(buffer); if (n < 0) break; output.write(buffer, 0, n); digest.update(buffer, 0, n); copied += n }
            }
            if (copied != size || digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) } != sha256) fail("fileCorrupt")
            output.flush()
        }
    }
}
