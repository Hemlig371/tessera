package app.tessera.personal;

import static org.junit.Assert.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.ByteArrayOutputStream;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.UUID;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class BinaryStoreTest {
    private String hex(byte[] bytes) { StringBuilder text = new StringBuilder(); for (byte value : bytes) text.append(String.format("%02x", value & 255)); return text.toString(); }
    private void removeTree(File file) { File[] children = file.listFiles(); if (children != null) for (File child : children) removeTree(child); file.delete(); }
    @Test public void boundedPrivateFilesHashReopenExportAndRefuseCorruption() throws Exception {
        File root = new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(), "binary-contract-" + UUID.randomUUID());
        String id = UUID.randomUUID().toString();
        BinaryStore store = new BinaryStore(root);
        try {
            store.begin(id);
            byte[] bytes = new byte[BinaryStore.CHUNK_SIZE]; Arrays.fill(bytes, (byte)73);
            MessageDigest hash = MessageDigest.getInstance("SHA-256");
            for (int n = 0; n < 45; n++) { store.write(id, (long)n * bytes.length, bytes); hash.update(bytes); }
            BinaryStore.Facts facts = store.finish(id, 45L * bytes.length, null);
            assertEquals(hex(hash.digest()), facts.getSha256());
            store = new BinaryStore(root);
            assertEquals(facts, store.inspect(id));
            assertArrayEquals(bytes, store.read(id, 44L * bytes.length, bytes.length));
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            store.export(id, facts.getSize(), facts.getSha256(), () -> output);
            assertEquals(facts.getSize(), output.size());
            try { store.begin(id); fail("must not replace existing bytes"); } catch (IllegalStateException expected) { assertEquals("fileExists", expected.getMessage()); }
            store.remove(id, true); assertEquals(facts, store.inspect(id));
            File original = new File(root, "attachments/" + id.substring(0,2) + "/" + id);
            try (java.io.FileOutputStream file = new java.io.FileOutputStream(original)) { file.write(1); }
            try { store.export(id, facts.getSize(), facts.getSha256(), () -> { fail("corrupt bytes must fail before opening destination"); return output; }); fail(); }
            catch (IllegalStateException expected) { assertEquals("fileCorrupt", expected.getMessage()); }
            store.remove(id, false); assertNull(store.inspect(id));
        } finally { removeTree(root); }
    }
    @Test public void interruptedPartsRemainInvisibleAndCanBeExplicitlyDiscarded() throws Exception {
        File root = new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(), "binary-contract-" + UUID.randomUUID());
        BinaryStore store = new BinaryStore(root); String id = UUID.randomUUID().toString();
        try {
            for (String bad : new String[]{"../app.sqlite", "/absolute", id.toUpperCase()}) {
                try { store.begin(bad); fail(); } catch (IllegalStateException expected) { assertEquals("invalidId", expected.getMessage()); }
            }
            store.begin(id);
            try { store.write(id, 1, new byte[]{1}); fail(); } catch (IllegalStateException expected) { assertEquals("invalidFileOffset", expected.getMessage()); }
            store.write(id, 0, new byte[]{1});
            store = new BinaryStore(root);
            assertNull(store.inspect(id));
            try { store.finish(id, 2, null); fail(); } catch (IllegalStateException expected) { assertEquals("fileCorrupt", expected.getMessage()); }
            assertNull(store.inspect(id)); store.remove(id, true); store.begin(id);
            BinaryStore.Facts empty = store.finish(id, 0, null);
            assertEquals(hex(MessageDigest.getInstance("SHA-256").digest()), empty.getSha256());
        } finally { removeTree(root); }
    }
    @androidx.test.filters.LargeTest @Test public void prepareInterruptedBinary() throws Exception {
        File root = new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(), "binary-process-acceptance");
        removeTree(root); BinaryStore store = new BinaryStore(root);
        String id = "00000000-0000-4000-8000-000000000001";
        store.begin(id); store.write(id, 0, new byte[BinaryStore.CHUNK_SIZE]);
        assertNull(store.inspect(id));
    }
    @androidx.test.filters.LargeTest @Test public void verifyInterruptedBinary() throws Exception {
        File root = new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(), "binary-process-acceptance");
        BinaryStore store = new BinaryStore(root); String id = "00000000-0000-4000-8000-000000000001";
        try {
            assertEquals(BinaryStore.CHUNK_SIZE, new File(root, "operational/file-staging/" + id + ".part").length());
            assertNull(store.inspect(id)); store.remove(id, true); store.begin(id); store.write(id, 0, new byte[]{7});
            BinaryStore.Facts facts = store.finish(id, 1, hex(MessageDigest.getInstance("SHA-256").digest(new byte[]{7})));
            assertEquals(facts, new BinaryStore(root).inspect(id));
        } finally { removeTree(root); }
    }

}
