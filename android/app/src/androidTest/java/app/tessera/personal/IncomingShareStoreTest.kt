package app.tessera.personal

import android.content.Intent
import android.util.Base64
import androidx.core.content.FileProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class IncomingShareStoreTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private fun reset() {
        context.getSharedPreferences("incoming-shares", android.content.Context.MODE_PRIVATE).edit().clear().commit()
        File(context.filesDir, "share-staging").deleteRecursively()
    }
    @Test fun directTextShareIsDurableUntilAckAndIdempotent() {
        reset()
        try {
            val store = IncomingShareStore(context)
            val intent = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "shared content")
            store.capture(intent)
            store.capture(intent)
            assertEquals(1, store.pending().items.length())
            val id = store.pending().items.getJSONObject(0).getString("id")
            assertEquals("shared content", store.pending().items.getJSONObject(0).getString("text"))
            assertTrue(store.acknowledge(id))
            assertEquals(0, store.pending().items.length())
        } finally { reset() }
    }
    @Test fun sharedFileIsCopiedPrivatelyAndCanBeReadAfterOriginalDisappears() {
        reset()
        val input = File(context.cacheDir, "tessera-share-fixture.bin")
        try {
            input.writeBytes(byteArrayOf(0, 1, -1, 17))
            val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", input)
            val intent = Intent(Intent.ACTION_SEND).setType("application/octet-stream")
                .putExtra(Intent.EXTRA_STREAM, uri)
            val store = IncomingShareStore(context)
            store.capture(intent)
            val pending = store.pending().items
            assertEquals(1, pending.length())
            val id = pending.getJSONObject(0).getString("id")
            val file = pending.getJSONObject(0).getJSONArray("files").getJSONObject(0)
            assertEquals(4L, file.getLong("size"))
            input.delete()
            assertArrayEquals(byteArrayOf(0, 1, -1, 17), Base64.decode(store.read(id, 0, 0, 4), Base64.NO_WRAP))
            assertTrue(store.acknowledge(id))
            assertEquals(0, store.pending().items.length())
        } finally { input.delete(); reset() }
    }
}
