package app.tessera.personal

import android.database.sqlite.SQLiteDatabase
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.LargeTest
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class ReplacementStoreTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private fun db(root: File) = File(root, "databases/app.sqlite")
    private fun store(root: File) = ReplacementStore(root, db(root))
    private fun database(path: File, marker: String) {
        path.parentFile!!.mkdirs()
        SQLiteDatabase.openOrCreateDatabase(path, null).use { it.execSQL("CREATE TABLE marker(value TEXT)"); it.execSQL("INSERT INTO marker VALUES(?)", arrayOf(marker)) }
    }
    private fun seed(root: File) {
        root.mkdirs(); database(db(root), "old")
        File(root, "attachments").mkdirs(); File(root, "attachments/original").writeText("old bytes")
        File(root, "operational/drafts").mkdirs(); File(root, "operational/drafts/draft").writeText("old draft")
        store(root).prepare(1); database(File(store(root).stage, "database.sqlite"), "new")
        File(store(root).stage, "attachments/imported").writeText("new bytes")
    }
    private fun verify(root: File, expected: String) {
        store(root).recover(); store(root).recover()
        SQLiteDatabase.openDatabase(db(root).path, null, SQLiteDatabase.OPEN_READONLY).use { database ->
            database.rawQuery("SELECT value FROM marker", null).use { assertTrue(it.moveToFirst()); assertEquals(expected, it.getString(0)) }
        }
        assertEquals(expected == "old", File(root, "attachments/original").exists())
        assertEquals(expected == "new", File(root, "attachments/imported").exists())
        assertEquals(expected == "old", File(root, "operational/drafts/draft").exists())
    }
    @Test fun interruptedRenameAndRecoveryAreAtomicForDatabaseFilesAndDrafts() {
        for (phase in listOf("prepared", "committed") + (0..8).flatMap { listOf("old-$it", "new-$it") }) {
            val root = File(context.cacheDir, "replace-" + UUID.randomUUID())
            try {
                seed(root)
                try { store(root).activate { if (it == phase) throw InterruptedException("injected process boundary") }; fail("phase not reached") }
                catch (_: InterruptedException) { }
                verify(root, if (phase == "committed") "new" else "old")
            } finally { root.deleteRecursively() }
        }
    }
    @Test @LargeTest fun prepareInterruptedReplacement() {
        val root = File(context.filesDir, "replacement-process-contract"); root.deleteRecursively(); seed(root)
        try { store(root).activate { if (it == "new-3") throw InterruptedException("host will force-stop before recovery") }; fail("phase not reached") }
        catch (_: InterruptedException) { }
        // Durable journal is left deliberately; host force-stops between these separate tests.
    }
    @Test fun corruptJournalRefusesToGuessAndPreservesBothCopies() {
        val root = File(context.cacheDir, "replace-corrupt-" + UUID.randomUUID())
        try {
            seed(root)
            try { store(root).activate { if (it == "new-0") throw InterruptedException() }; fail("phase not reached") } catch (_: InterruptedException) { }
            val journal = File(root, "operational/db-import-state.json")
            val envelope = org.json.JSONObject(journal.readText())
            envelope.put("payload", envelope.getString("payload").replace("false", "true")); journal.writeText(envelope.toString())
            try { store(root).recover(); fail("corrupt journal accepted") } catch (error: IllegalStateException) { assertEquals("importRecoveryFailed", error.message) }
            assertTrue(db(root).isFile); assertTrue(File(root, "operational/db-import/old/database.sqlite").isFile)
        } finally { root.deleteRecursively() }
    }
    @Test @LargeTest fun verifyInterruptedReplacement() {
        val root = File(context.filesDir, "replacement-process-contract")
        try { verify(root, "old") } finally { root.deleteRecursively() }
    }
}
