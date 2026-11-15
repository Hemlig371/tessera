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
            awaitJs(scenario, "!!document.querySelector('[data-editor] input[aria-label=Название]')");
            js(scenario, "(()=>{const input=document.querySelector('[data-editor] input[aria-label=Название]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Android draft survives process death'); input.dispatchEvent(new Event('input',{bubbles:true}));})()");
            File file = draftFile(draftScope(scenario));
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
            while (!file.exists() && System.nanoTime() < deadline) Thread.sleep(200);
            assertTrue("Debounced draft file was not created", file.isFile());
            String content = new String(java.nio.file.Files.readAllBytes(file.toPath()), java.nio.charset.StandardCharsets.UTF_8);
            assertTrue("Native draft file did not contain the unsaved input", content.contains("Android draft survives process death"));
            UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
            device.pressBack();
            awaitJs(scenario, "!document.querySelector('[data-editor]')");
            assertTrue("System Back must preserve the creation draft", file.isFile());
            js(scenario, "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='+ Новая запись').click()");
            awaitJs(scenario, "document.querySelector('[data-editor] input[aria-label=Название]')?.value==='Android draft survives process death'");
            js(scenario, "(()=>{const input=document.querySelector('[data-editor] input[aria-label=Название]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Android paused draft survives process death'); input.dispatchEvent(new Event('input',{bubbles:true}));})()");
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
            assertEquals("false", js(scenario, "!!document.querySelector('[data-editor]')"));
            openDraftCollection(scenario);
            awaitJs(scenario, "[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='+ Новая запись' && !b.disabled)");
            assertEquals("false", js(scenario, "!!document.querySelector('[data-editor]')"));
            js(scenario, "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='+ Новая запись').click()");
            awaitJs(scenario, "document.querySelector('[data-editor] input[aria-label=Название]')?.value==='Android paused draft survives process death'");
            File file = draftFile(draftScope(scenario));
            js(scenario, "[...document.querySelectorAll('[data-editor] button')].find(b=>b.textContent==='Сохранить').click()");
            awaitJs(scenario, "!document.querySelector('[data-editor]')");
            assertFalse("Successful save did not remove the native draft file", file.exists());
            System.out.println("DRAFT_PROCESS passed: native file survived force-stop and was restored only on creation and removed only by Save");
        }
    }
    private void openProfileCollection(ActivityScenario<MainActivity> scenario) throws Exception {
        awaitJs(scenario, "[...document.querySelectorAll('nav button')].some(b=>b.textContent.includes('Заметки: профили (dev/CI)'))");
        js(scenario, "[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('Заметки: профили (dev/CI)')).click()");
        awaitJs(scenario, "[...document.querySelectorAll('nav button')].some(b=>b.getAttribute('aria-label')==='Заметки')");
        js(scenario, "[...document.querySelectorAll('nav button')].find(b=>b.getAttribute('aria-label')==='Заметки').click()");
        awaitJs(scenario, "!!document.querySelector('.profile-switcher select') && document.querySelectorAll('.entry').length>0");
    }
    @Test public void namedProfilesShareRecordsAndPersistDefaultAfterRecreation() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            openProfileCollection(scenario);
            js(scenario, "(()=>{const select=document.querySelector('.profile-switcher select'); select.value=[...select.options].find(option=>option.text==='Только Бета').value; select.dispatchEvent(new Event('change',{bubbles:true}));})()");
            awaitJs(scenario, "document.querySelectorAll('.entry').length===1 && document.querySelector('.entry').textContent.includes('Бета')");
            openConstructor(scenario);
            js(scenario, "[...document.querySelectorAll('button')].find(button=>button.textContent==='Представления').click()");
            awaitJs(scenario, "!!document.querySelector('[data-editor] select')");
            js(scenario, "(()=>{const select=document.querySelector('[data-editor] select'); select.value=[...select.options].find(option=>option.text==='Только Бета').value; select.dispatchEvent(new Event('change',{bubbles:true}));})()");
            awaitJs(scenario, "!!document.querySelector('[data-editor] input[type=checkbox]:not(:disabled)')");
            js(scenario, "document.querySelector('[data-editor] input[type=checkbox]').click()");
            awaitJs(scenario, "!!document.querySelector('[data-editor] input[type=checkbox]:checked')");
            js(scenario, "[...document.querySelectorAll('[data-editor] button')].find(button=>button.textContent==='Сохранить представление').click()");
            awaitJs(scenario, "!!document.querySelector('[data-editor] input[type=checkbox]:disabled:checked') && [...document.querySelectorAll('[data-editor] button')].some(button=>button.textContent==='Сохранить представление' && !button.disabled)");
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack();
            awaitJs(scenario, "!document.querySelector('[data-editor]')");
            scenario.recreate();
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            openProfileCollection(scenario);
            awaitJs(scenario, "document.querySelector('.profile-switcher option:checked')?.textContent==='Только Бета' && document.querySelectorAll('.entry').length===1");
        }
    }
    @Test public void creationPresetKeepsDraftAndSavesThroughNativeRepository() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            awaitJs(scenario, "[...document.querySelectorAll('nav button')].some(button=>button.textContent.includes('Проекты и задачи (dev/CI)'))");
            js(scenario, "[...document.querySelectorAll('nav button')].find(button=>button.textContent.includes('Проекты и задачи (dev/CI)')).click()");
            awaitJs(scenario, "[...document.querySelectorAll('nav button')].some(button=>button.getAttribute('aria-label')==='Задачи')");
            js(scenario, "[...document.querySelectorAll('nav button')].find(button=>button.getAttribute('aria-label')==='Задачи').click()");
            awaitJs(scenario, "!!document.querySelector('.split-button button:not(:disabled)')");
            js(scenario, "document.querySelector('.split-button button:last-child').click()");
            awaitJs(scenario, "!!document.querySelector('[role=menuitem]')");
            js(scenario, "[...document.querySelectorAll('[role=menuitem]')].find(button=>button.textContent==='Новый баг').click()");
            awaitJs(scenario, "!!document.querySelector('[data-editor] input[aria-label=Название]')");
            assertEquals("false", js(scenario, "!!document.querySelector('[data-editor] textarea')"));
            js(scenario, "(()=>{const input=document.querySelector('[data-editor] input[aria-label=Название]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Android preset draft'); input.dispatchEvent(new Event('input',{bubbles:true}));})()");
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack();
            awaitJs(scenario, "!document.querySelector('[data-editor]')");
            js(scenario, "document.querySelector('.split-button button:last-child').click()");
            awaitJs(scenario, "!!document.querySelector('[role=menuitem]')");
            js(scenario, "[...document.querySelectorAll('[role=menuitem]')].find(button=>button.textContent==='Новый баг').click()");
            awaitJs(scenario, "document.querySelector('[data-editor] input[aria-label=Название]')?.value==='Android preset draft' && !!document.querySelector('[data-editor] textarea')");
            assertEquals("\"Ошибка\"", js(scenario, "document.querySelector('[data-editor] input[aria-label=Тип]').value"));
            assertEquals("\"0\"", js(scenario, "document.querySelector('[data-editor] input[aria-label=Приоритет]').value"));
            assertEquals("\"false\"", js(scenario, "document.querySelector('[data-editor] select[aria-label=Готово]').value"));
            js(scenario, "[...document.querySelectorAll('[data-editor] button')].find(button=>button.textContent==='Сохранить').click()");
            awaitJs(scenario, "!document.querySelector('[data-editor]') && [...document.querySelectorAll('.entry')].some(row=>row.textContent.includes('Android preset draft'))");
        }
    }
    @Test public void adaptiveRowsRevealRequiredControlsAndPersistThroughRecreation() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            awaitJs(scenario, "[...document.querySelectorAll('nav button')].some(b=>b.textContent.includes('Заметки: строки (dev/CI)'))");
            js(scenario, "[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('Заметки: строки (dev/CI)')).click()");
            awaitJs(scenario, "[...document.querySelectorAll('nav button')].some(b=>b.getAttribute('aria-label')==='Заметки')");
            js(scenario, "[...document.querySelectorAll('nav button')].find(b=>b.getAttribute('aria-label')==='Заметки').click()");
            awaitJs(scenario, "[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='+ Новая запись' && !b.disabled)");
            js(scenario, "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='+ Новая запись').click()");
            awaitJs(scenario, "!!document.querySelector('[data-editor] input[aria-label=Название]:not(:disabled)')");
            assertEquals("false", js(scenario, "document.querySelector('[data-editor] .collapsed-field').open"));
            assertEquals("1", js(scenario, "getComputedStyle(document.querySelector('[data-editor] .layout-row')).gridTemplateColumns.split(' ').length"));
            js(scenario, "[...document.querySelectorAll('[data-editor] button')].find(b=>b.textContent==='Сохранить').click()");
            awaitJs(scenario, "document.querySelector('[data-editor] .collapsed-field').open");
            js(scenario, "(()=>{const input=document.querySelector('[data-editor] input[aria-label=Название]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Android layout record');input.dispatchEvent(new Event('input',{bubbles:true}));const text=document.querySelector('[data-editor] textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(text,'**Native rows**');text.dispatchEvent(new Event('input',{bubbles:true}));})()");
            assertEquals("\"0\"", js(scenario, "document.querySelector('[data-editor] input[aria-label=Приоритет]').value"));
            assertEquals("\"false\"", js(scenario, "document.querySelector('[data-editor] select[aria-label=Избранное]').value"));
            js(scenario, "[...document.querySelectorAll('[data-editor] button')].find(b=>b.textContent==='Сохранить').click()");
            awaitJs(scenario, "!document.querySelector('[data-editor]') && [...document.querySelectorAll('.entry')].some(b=>b.textContent.includes('Android layout record'))");
            scenario.recreate();
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            awaitJs(scenario, "[...document.querySelectorAll('nav button')].some(b=>b.textContent.includes('Заметки: строки (dev/CI)'))");
            js(scenario, "[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('Заметки: строки (dev/CI)')).click()");
            awaitJs(scenario, "[...document.querySelectorAll('nav button')].some(b=>b.getAttribute('aria-label')==='Заметки')");
            js(scenario, "[...document.querySelectorAll('nav button')].find(b=>b.getAttribute('aria-label')==='Заметки').click()");
            awaitJs(scenario, "[...document.querySelectorAll('.entry')].some(b=>b.textContent.includes('Android layout record'))");
            js(scenario, "[...document.querySelectorAll('.entry')].find(b=>b.textContent.includes('Android layout record')).click()");
            awaitJs(scenario, "document.querySelector('.detail .layout-row .markdown strong')?.textContent==='Native rows'");
        }
    }
    @Test public void constructorModeExitsWithSystemBackWithoutLosingTheProfile() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            openProfileCollection(scenario);
            awaitJs(scenario, "!!document.querySelector('#constructor-toggle:not(:disabled)')");
            assertEquals("false", js(scenario, "[...document.querySelectorAll('button')].some(button=>button.textContent==='Поля')"));
            String profile = js(scenario, "document.querySelector('.profile-switcher select').value");
            openConstructor(scenario);
            awaitJs(scenario, "[...document.querySelectorAll('button')].some(button=>button.textContent==='Поля' && !button.disabled)");
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack();
            awaitJs(scenario, "document.querySelector('#constructor-toggle').getAttribute('aria-pressed')==='false'");
            assertEquals(profile, js(scenario, "document.querySelector('.profile-switcher select').value"));
            assertEquals("false", js(scenario, "[...document.querySelectorAll('button')].some(button=>button.textContent==='Поля')"));
        }
    }
    @Test public void deviceAppearancePersistsAcrossRecreationAndFollowsNativeNightMode() throws Exception {
        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        String original = device.executeShellCommand("cmd uimode night");
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            awaitJs(scenario, "[...document.querySelectorAll('button')].some(b=>b.textContent==='Оформление' && !b.disabled)");
            js(scenario, "[...document.querySelectorAll('button')].find(b=>b.textContent==='Оформление').click()");
            awaitJs(scenario, "!!document.querySelector('[data-editor] select')");
            js(scenario, "(()=>{const controls=document.querySelectorAll('[data-editor] select'); for(const [i,value] of ['dark','compact','1.5'].entries()){controls[i].value=value;controls[i].dispatchEvent(new Event('change',{bubbles:true}));}})()");
            js(scenario, "[...document.querySelectorAll('[data-editor] button')].find(b=>b.textContent==='Сохранить оформление').click()");
            awaitJs(scenario, "!document.querySelector('[data-editor]') && document.documentElement.dataset.theme==='dark'");
            scenario.recreate();
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            awaitJs(scenario, "document.documentElement.dataset.theme==='dark' && document.documentElement.dataset.density==='compact' && parseFloat(getComputedStyle(document.documentElement).fontSize)>=22.4");
            js(scenario, "[...document.querySelectorAll('button')].find(b=>b.textContent==='Оформление').click()");
            awaitJs(scenario, "!!document.querySelector('[data-editor] select')");
            js(scenario, "(()=>{const select=document.querySelector('[data-editor] select');select.value='system';select.dispatchEvent(new Event('change',{bubbles:true}));})()");
            js(scenario, "[...document.querySelectorAll('[data-editor] button')].find(b=>b.textContent==='Сохранить оформление').click()");
            awaitJs(scenario, "!document.querySelector('[data-editor]')");
            device.executeShellCommand("cmd uimode night yes");
            awaitJs(scenario, "document.documentElement.dataset.theme==='dark'");
            device.executeShellCommand("cmd uimode night no");
            awaitJs(scenario, "document.documentElement.dataset.theme==='light'");
            assertEquals("true", js(scenario, "document.documentElement.scrollWidth<=innerWidth"));
        } finally { device.executeShellCommand("cmd uimode night " + (original.contains("yes") ? "yes" : original.contains("no") ? "no" : "auto")); }
    }
    @Test public void markdownRendersAsSafeNodesAndRetainsOriginalAfterMove() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            awaitJs(scenario, "[...document.querySelectorAll('nav button')].some(button=>button.textContent.includes('Заметки: Markdown (dev/CI)'))");
            js(scenario, "[...document.querySelectorAll('nav button')].find(button=>button.textContent.includes('Заметки: Markdown (dev/CI)')).click()");
            awaitJs(scenario, "[...document.querySelectorAll('nav button')].some(button=>button.getAttribute('aria-label')==='Заметки')");
            js(scenario, "[...document.querySelectorAll('nav button')].find(button=>button.getAttribute('aria-label')==='Заметки').click()");
            awaitJs(scenario, "[...document.querySelectorAll('.entry')].some(row=>row.textContent.includes('Native Markdown'))");
            js(scenario, "Reflect.set(window,'nativeMarkdownXss',false); [...document.querySelectorAll('.entry')].find(row=>row.textContent.includes('Native Markdown')).click()");
            awaitJs(scenario, "!!document.querySelector('.detail .markdown strong')");
            assertEquals("\"Безопасно\"", js(scenario, "document.querySelector('.detail .markdown strong').textContent"));
            assertEquals("false", js(scenario, "Reflect.get(window,'nativeMarkdownXss')"));
            assertEquals("0", js(scenario, "document.querySelectorAll('.detail .markdown script,.detail .markdown img').length"));
            assertEquals("true", js(scenario, "document.querySelector('.detail .original-content').textContent.startsWith('# Native Markdown **ёж**')"));
        }
    }
    private void openConstructor(ActivityScenario<MainActivity> scenario) throws Exception {
        awaitJs(scenario, "!!document.querySelector('#constructor-toggle:not(:disabled)')");
        if (!"true".equals(js(scenario, "document.querySelector('#constructor-toggle').getAttribute('aria-pressed')==='true'"))) {
            js(scenario, "document.querySelector('#constructor-toggle').click()");
            awaitJs(scenario, "document.querySelector('#constructor-toggle').getAttribute('aria-pressed')==='true'");
        }
    }
    @Test public void explicitSaveKeepsDeepNativeListAndProfile() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            js(scenario, "[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('База знаний (dev/CI)')).click()");
            awaitJs(scenario, "[...document.querySelectorAll('nav button')].some(b=>b.getAttribute('aria-label')==='Материалы')");
            js(scenario, "[...document.querySelectorAll('nav button')].find(b=>b.getAttribute('aria-label')==='Материалы').click()");
            awaitJs(scenario, "document.querySelector('.list-meta')?.textContent==='Загружено записей: 100'");
            for (int count : new int[]{200, 250}) {
                js(scenario, "[...document.querySelectorAll('button')].find(b=>b.textContent==='Показать ещё').click()");
                awaitJs(scenario, "document.querySelector('.list-meta')?.textContent==='Загружено записей: " + count + "'");
            }
            js(scenario, "document.querySelector('.entry-scroll').scrollTop=document.querySelector('.entry').getBoundingClientRect().height*219");
            awaitJs(scenario, "[...document.querySelectorAll('.entry')].some(b=>b.textContent.includes('Материал 220'))");
            String offset = js(scenario, "document.querySelector('.entry-scroll').scrollTop");
            String profile = js(scenario, "document.querySelector('.profile-switcher select').value");
            js(scenario, "const row=[...document.querySelectorAll('.entry')].find(b=>b.textContent.includes('Материал 220'));row.focus();row.click()");
            awaitJs(scenario, "document.querySelector('.detail #record-title')?.textContent==='Материал 220'");
            js(scenario, "[...document.querySelectorAll('.detail button')].find(b=>b.textContent==='Редактировать').click()");
            awaitJs(scenario, "!!document.querySelector('[data-editor] select[aria-label=Прочитано]:not(:disabled)')");
            js(scenario, "const input=document.querySelector('[data-editor] select[aria-label=Прочитано]');input.value=input.value==='true'?'false':'true';input.dispatchEvent(new Event('change',{bubbles:true}))");
            js(scenario, "[...document.querySelectorAll('[data-editor] button')].find(b=>b.textContent==='Сохранить').click()");
            awaitJs(scenario, "!document.querySelector('[data-editor]') && !!document.querySelector('.detail')");
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack();
            awaitJs(scenario, "!document.querySelector('.detail') && document.querySelector('.list-meta')?.textContent==='Загружено записей: 250'");
            awaitJs(scenario, "Math.abs(document.querySelector('.entry-scroll').scrollTop-" + offset + ")<1");
            assertEquals(profile, js(scenario, "document.querySelector('.profile-switcher select').value"));
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
            awaitJs(scenario, "!!document.querySelector('.detail #record-title')");
            assertEquals("\"Bridge roundtrip\"", js(scenario, "document.querySelector('.detail #record-title').textContent"));
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack();
            awaitJs(scenario, "!document.querySelector('.detail')");
            // Real ACTION_CREATE_DOCUMENT, real DocumentsUI, real UTF-8 file on disk.
            UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
            device.executeShellCommand("rm -f /sdcard/Download/Tessera-acceptance.csv");
            js(scenario, "[...document.querySelectorAll('button')].find(b=>b.textContent==='CSV').click()");
            awaitJs(scenario, "!!document.querySelector('[data-editor]')");
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
            awaitJs(scenario, "[...document.querySelectorAll('[data-editor] button')].some(b=>b.getAttribute('aria-label')==='Назад' && !b.disabled)");
            js(scenario, "[...document.querySelectorAll('[data-editor] button')].find(b=>b.getAttribute('aria-label')==='Назад').click()");
            awaitJs(scenario, "!document.querySelector('[data-editor]')");

            // A real reverse relation block opens its source record in the mobile WebView.
            js(scenario, "[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('Связи этапа 3')).click()");
            awaitJs(scenario, "[...document.querySelectorAll('nav button')].some(b=>b.getAttribute('aria-label')==='Проекты')");
            js(scenario, "[...document.querySelectorAll('nav button')].find(b=>b.getAttribute('aria-label')==='Проекты').click()");
            awaitJs(scenario, "[...document.querySelectorAll('.entry')].some(b=>b.textContent.includes('Родитель связи'))");
            js(scenario, "[...document.querySelectorAll('.entry')].find(b=>b.textContent.includes('Родитель связи')).click()");
            awaitJs(scenario, "[...document.querySelectorAll('.relation-row')].some(b=>b.textContent.includes('Правка со ссылкой'))");
            js(scenario, "[...document.querySelectorAll('.relation-row')].find(b=>b.textContent.includes('Правка со ссылкой')).click()");
            awaitJs(scenario, "document.querySelector('.detail #record-title')?.textContent==='Правка со ссылкой'");
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack();
            awaitJs(scenario, "document.querySelector('.detail #record-title')?.textContent==='Родитель связи'");
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack();
            awaitJs(scenario, "!document.querySelector('.detail') && [...document.querySelectorAll('.entry')].some(button=>button.textContent.includes('Родитель связи'))");
            scenario.recreate();
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
        }
    }
}
