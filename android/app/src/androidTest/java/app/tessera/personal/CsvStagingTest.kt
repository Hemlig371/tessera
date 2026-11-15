package app.tessera.personal

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.core.app.ActivityScenario
import androidx.test.filters.LargeTest
import androidx.test.platform.app.InstrumentationRegistry
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.OutputStream
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CsvStagingTest {
    private fun directory() = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, "csv-test-${java.util.UUID.randomUUID()}")
    @Test @LargeTest fun prepareInterruptedCsv() {
        val directory = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, "csv-export")
        StagedCsv.removeInterrupted(directory)
        val staged = StagedCsv(directory)
        staged.write("CSV staged before Android process death 🦔")
        assertEquals(1, directory.listFiles()!!.size)
        // The host force-stops this process; neither finish nor abort is called.
    }
    @Test @LargeTest fun verifyInterruptedCsv() {
        val directory = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, "csv-export")
        assertTrue("Interrupted private CSV file missing before relaunch", directory.listFiles()!!.isNotEmpty())
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity -> assertNotNull(activity.bridge.getPlugin("CsvFiles").instance) }
            assertTrue("Plugin startup did not remove interrupted CSV staging", directory.listFiles()!!.isEmpty())
        }
    }
    @Test fun stagesUnicodeUntilFinishAndWaitsForProviderClose() {
        val directory = directory()
        try {
            val staged = StagedCsv(directory)
            val bytes = ByteArrayOutputStream()
            var opened = false; var closed = false
            staged.write("\uFEFFНазвание\r\n"); staged.write("Ёж 🦔\r\n")
            assertFalse(opened); assertEquals(1, directory.listFiles()!!.size)
            staged.finish {
                opened = true
                object : OutputStream() {
                    override fun write(value: Int) { bytes.write(value) }
                    override fun close() { closed = true }
                }
            }
            assertTrue(opened); assertTrue(closed)
            assertEquals("\uFEFFНазвание\r\nЁж 🦔\r\n", bytes.toString("UTF-8"))
            assertEquals(0, directory.listFiles()!!.size)
        } finally { directory.deleteRecursively() }
    }
    @Test fun providerWriteAndCloseFailuresCannotReportSuccessAndAbortIsRepeatable() {
        val directory = directory()
        try {
            for (failClose in listOf(false, true)) {
                val staged = StagedCsv(directory); staged.write("Готовый CSV")
                var completed = false; var closed = false
                try {
                    staged.finish { object : OutputStream() {
                        override fun write(value: Int) { if (!failClose) throw IOException("injected write failure") }
                        override fun close() { closed = true; if (failClose) throw IOException("injected close failure") }
                    } }
                    completed = true
                } catch (_: IOException) { }
                assertFalse(completed); assertTrue(closed)
                staged.abort(); staged.abort(); assertEquals(0, directory.listFiles()!!.size)
            }
        } finally { directory.deleteRecursively() }
    }
    @Test fun restartRemovesInterruptedPrivateStagingOnly() {
        val directory = directory()
        try {
            val staged = StagedCsv(directory); staged.write("Незавершённый экспорт")
            // Model the private file left after process death, with no provider opened.
            val interrupted = directory.listFiles()!!.single()
            staged.abort(); interrupted.writeText("partial bytes")
            val other = File(directory, "keep.txt"); other.writeText("keep")
            StagedCsv.removeInterrupted(directory)
            assertFalse(interrupted.exists()); assertTrue(other.exists())
        } finally { directory.deleteRecursively() }
    }
}
