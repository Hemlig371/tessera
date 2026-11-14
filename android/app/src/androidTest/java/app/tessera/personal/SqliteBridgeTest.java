package app.tessera.personal;

import android.content.pm.ApplicationInfo;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
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
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(60);
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
            assertEquals("null", js(scenario, "document.documentElement.dataset.acceptanceError || null"));
            awaitJs(scenario, "!!document.querySelector('nav button')");
            js(scenario, "[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('Контракт')).click()");
            awaitJs(scenario, "[...document.querySelectorAll('nav button')].some(b=>b.textContent==='Записи')");
            js(scenario, "[...document.querySelectorAll('nav button')].find(b=>b.textContent==='Записи').click()");
            awaitJs(scenario, "[...document.querySelectorAll('.entry')].some(b=>b.textContent.includes('Bridge roundtrip'))");
            js(scenario, "[...document.querySelectorAll('.entry')].find(b=>b.textContent.includes('Bridge roundtrip')).click()");
            awaitJs(scenario, "!!document.querySelector('.detail h2')");
            assertEquals("\"Bridge roundtrip\"", js(scenario, "document.querySelector('.detail h2').textContent"));
            scenario.recreate();
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'");
        }
    }
}
