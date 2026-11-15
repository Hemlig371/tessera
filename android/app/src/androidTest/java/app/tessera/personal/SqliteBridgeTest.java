package app.tessera.personal;

import android.content.pm.ApplicationInfo;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.Until;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class SqliteBridgeTest {
    private String js(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, value -> {
            result.set(value); latch.countDown();
        }));
        assertTrue("WebView callback timed out", latch.await(10, TimeUnit.SECONDS));
        return result.get();
    }
    private void awaitJs(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.MINUTES.toNanos(15);
        while (System.nanoTime() < deadline) {
            if ("true".equals(js(scenario, script))) return;
            Thread.sleep(200);
        }
        fail("WebView assertion timed out: " + script + "; body=" + js(scenario, "document.body.innerText"));
    }
    @Test public void sqliteContractAndRealUiSurviveWebViewRecreation() throws Exception {
        var context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals(0, context.getApplicationInfo().flags & ApplicationInfo.FLAG_ALLOW_BACKUP);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            // This value is set only after all SQL assertions and reopen have passed.
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'");
            System.out.println("STAGE2_SCALE " + js(scenario, "document.documentElement.dataset.scale"));
            assertEquals("null", js(scenario, "document.documentElement.dataset.acceptanceError || null"));
            awaitJs(scenario, "!!document.querySelector('nav button')");
            js(scenario, "[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('Контракт')).click()");
            awaitJs(scenario, "[...document.querySelectorAll('nav button')].some(b=>b.getAttribute('aria-label')==='Записи')");
            js(scenario, "[...document.querySelectorAll('nav button')].find(b=>b.getAttribute('aria-label')==='Записи').click()");
            awaitJs(scenario, "[...document.querySelectorAll('.entry')].some(b=>b.textContent.includes('Bridge roundtrip'))");
            js(scenario, "[...document.querySelectorAll('.entry')].find(b=>b.textContent.includes('Bridge roundtrip')).click()");
            awaitJs(scenario, "!!document.querySelector('.detail h2')");
            assertEquals("\"Bridge roundtrip\"", js(scenario, "document.querySelector('.detail h2').textContent"));
            // Real ACTION_CREATE_DOCUMENT, real DocumentsUI, real UTF-8 file on disk.
            UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
            device.executeShellCommand("rm -f /sdcard/Download/Tessera-acceptance.csv");
            js(scenario, "[...document.querySelectorAll('button')].find(b=>b.textContent==='CSV').click()");
            awaitJs(scenario, "!!document.querySelector('[role=dialog]')");
            js(scenario, "[...document.querySelectorAll('button')].find(b=>b.textContent==='Сохранить CSV').click()");
            var filename = device.wait(Until.findObject(By.clazz("android.widget.EditText")), 30000);
            assertNotNull("SAF filename input missing", filename);
            filename.setText("Tessera-acceptance.csv");
            var save = device.wait(Until.findObject(By.text(java.util.regex.Pattern.compile("(?i)save"))), 10000);
            assertNotNull("SAF Save button missing", save); save.click();
            awaitJs(scenario, "document.body.innerText.includes('Экспортировано записей: 1')");
            String csv = device.executeShellCommand("cat /sdcard/Download/Tessera-acceptance.csv");
            assertTrue("Actual SAF CSV did not contain the record: " + csv, csv.contains("Bridge roundtrip"));
            assertTrue("CSV header missing", csv.contains("Название"));
            js(scenario, "[...document.querySelectorAll('[role=dialog] button')].find(b=>b.getAttribute('aria-label')==='Закрыть').click()");
            scenario.recreate();
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'");
        }
    }
}
