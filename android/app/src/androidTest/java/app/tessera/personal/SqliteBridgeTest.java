package app.tessera.personal;

import android.content.pm.ApplicationInfo;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.Until;
import androidx.test.filters.LargeTest;
import java.io.File;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class SqliteBridgeTest {
    private JSONObject draftScope(ActivityScenario<MainActivity> scenario) throws Exception {
        return new JSONObject((String)new JSONTokener(js(scenario, "document.documentElement.dataset.draftFixture")).nextValue());
    }
    private File draftFile(JSONObject scope) throws Exception {
        var context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        return new File(context.getFilesDir(), "operational/drafts/" + scope.getString("dataset_id") + "/" + scope.getString("library_id") + "/" + scope.getString("collection_id") + ".json");
    }
    private void openDraftCollection(ActivityScenario<MainActivity> scenario) throws Exception {
        awaitJs(scenario, "[...document.querySelectorAll('nav button')].some(b=>b.textContent.includes('Заметки (dev/CI)'))");
        js(scenario, "[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('Заметки (dev/CI)')).click()");
        awaitJs(scenario, "[...document.querySelectorAll('nav button')].some(b=>b.getAttribute('aria-label')==='Заметки')");
        js(scenario, "[...document.querySelectorAll('nav button')].find(b=>b.getAttribute('aria-label')==='Заметки').click()");
    }
    // Host script runs these phases in separate instrumentation processes with am force-stop between them.
    @Test @LargeTest public void preparePersistentDraft() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            openDraftCollection(scenario);
            awaitJs(scenario, "[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='+ Новая запись' && !b.disabled)");
            js(scenario, "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='+ Новая запись').click()");
            awaitJs(scenario, "!!document.querySelector('[role=dialog] input[aria-label=Название]')");
            js(scenario, "(()=>{const input=document.querySelector('[role=dialog] input[aria-label=Название]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Android draft survives process death'); input.dispatchEvent(new Event('input',{bubbles:true}));})()");
            File file = draftFile(draftScope(scenario));
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
            while (!file.exists() && System.nanoTime() < deadline) Thread.sleep(200);
            assertTrue("Debounced draft file was not created", file.isFile());
            String content = new String(java.nio.file.Files.readAllBytes(file.toPath()), java.nio.charset.StandardCharsets.UTF_8);
            assertTrue("Native draft file did not contain the unsaved input", content.contains("Android draft survives process death"));
            UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
            device.pressBack();
            awaitJs(scenario, "!document.querySelector('[role=dialog]')");
            assertTrue("System Back must preserve the creation draft", file.isFile());
            js(scenario, "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='+ Новая запись').click()");
            awaitJs(scenario, "document.querySelector('[role=dialog] input[aria-label=Название]')?.value==='Android draft survives process death'");
            js(scenario, "(()=>{const input=document.querySelector('[role=dialog] input[aria-label=Название]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Android paused draft survives process death'); input.dispatchEvent(new Event('input',{bubbles:true}));})()");
            device.pressHome();
            deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
            while (System.nanoTime() < deadline && !new String(java.nio.file.Files.readAllBytes(file.toPath()), java.nio.charset.StandardCharsets.UTF_8).contains("Android paused draft survives process death")) Thread.sleep(100);
            assertTrue("Pausing must flush the latest native draft", new String(java.nio.file.Files.readAllBytes(file.toPath()), java.nio.charset.StandardCharsets.UTF_8).contains("Android paused draft survives process death"));
        }
    }
    @Test @LargeTest public void verifyPersistentDraft() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            awaitJs(scenario, "!!document.querySelector('nav button')");
            assertEquals("false", js(scenario, "!!document.querySelector('[role=dialog]')"));
            openDraftCollection(scenario);
            awaitJs(scenario, "[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='+ Новая запись' && !b.disabled)");
            assertEquals("false", js(scenario, "!!document.querySelector('[role=dialog]')"));
            js(scenario, "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='+ Новая запись').click()");
            awaitJs(scenario, "document.querySelector('[role=dialog] input[aria-label=Название]')?.value==='Android paused draft survives process death'");
            File file = draftFile(draftScope(scenario));
            js(scenario, "[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent==='Сохранить').click()");
            awaitJs(scenario, "!document.querySelector('[role=dialog]')");
            assertFalse("Successful save did not remove the native draft file", file.exists());
            System.out.println("DRAFT_PROCESS passed: native file survived force-stop and was restored only on creation and removed only by Save");
        }
    }
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
        awaitJs(scenario, script, 30);
    }
    private void awaitJs(ActivityScenario<MainActivity> scenario, String script, long timeoutSeconds) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(timeoutSeconds);
        while (System.nanoTime() < deadline) {
            String startupFailure = js(scenario, "document.documentElement.dataset.acceptance === 'failed' ? (document.documentElement.dataset.acceptanceStage + ': ' + document.documentElement.dataset.acceptanceError) : null");
            if (!"null".equals(startupFailure)) fail("Native acceptance failed: " + startupFailure);
            if ("true".equals(js(scenario, script))) return;
            Thread.sleep(200);
        }
        fail("WebView assertion timed out: " + script + "; stage=" + js(scenario, "document.documentElement.dataset.acceptanceStage") + "; body=" + js(scenario, "document.body.innerText"));
    }
    @Test public void sqliteContractAndRealUiSurviveWebViewRecreation() throws Exception {
        var context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals(0, context.getApplicationInfo().flags & ApplicationInfo.FLAG_ALLOW_BACKUP);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            // This value is set only after all SQL assertions and reopen have passed.
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            System.out.println("STAGE3_SCALE " + js(scenario, "document.documentElement.dataset.scale"));
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
            // Export status appears before run() finishes reloading metadata and enabling controls.
            awaitJs(scenario, "[...document.querySelectorAll('[role=dialog] button')].some(b=>b.getAttribute('aria-label')==='Закрыть' && !b.disabled)");
            js(scenario, "[...document.querySelectorAll('[role=dialog] button')].find(b=>b.getAttribute('aria-label')==='Закрыть').click()");
            awaitJs(scenario, "!document.querySelector('[role=dialog]')");

            // A real reverse relation block opens its source record in the mobile WebView.
            js(scenario, "[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('Связи этапа 3')).click()");
            awaitJs(scenario, "[...document.querySelectorAll('nav button')].some(b=>b.getAttribute('aria-label')==='Проекты')");
            js(scenario, "[...document.querySelectorAll('nav button')].find(b=>b.getAttribute('aria-label')==='Проекты').click()");
            awaitJs(scenario, "[...document.querySelectorAll('.entry')].some(b=>b.textContent.includes('Родитель связи'))");
            js(scenario, "[...document.querySelectorAll('.entry')].find(b=>b.textContent.includes('Родитель связи')).click()");
            awaitJs(scenario, "[...document.querySelectorAll('.relation-row')].some(b=>b.textContent.includes('Правка со ссылкой'))");
            js(scenario, "[...document.querySelectorAll('.relation-row')].find(b=>b.textContent.includes('Правка со ссылкой')).click()");
            awaitJs(scenario, "document.querySelector('.detail h2')?.textContent==='Правка со ссылкой'");
            scenario.recreate();
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
        }
    }
}
