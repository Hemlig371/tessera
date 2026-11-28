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
        awaitJs(scenario, "[...document.querySelectorAll('[data-catalog=libraries] .catalog-item')].some(b=>b.textContent.includes('Заметки (dev/CI)'))");
        js(scenario, "[...document.querySelectorAll('[data-catalog=libraries] .catalog-item')].find(b=>b.textContent.includes('Заметки (dev/CI)')).click()");
        awaitJs(scenario, "[...document.querySelectorAll('[data-catalog=collections] .catalog-item')].some(b=>b.querySelector('.catalog-copy strong')?.textContent==='Заметки')");
        js(scenario, "[...document.querySelectorAll('[data-catalog=collections] .catalog-item')].find(b=>b.querySelector('.catalog-copy strong')?.textContent==='Заметки').click()");
    }
    // Host script runs these phases in separate instrumentation processes with am force-stop between them.
    @Test @LargeTest public void preparePersistentDraft() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            openDraftCollection(scenario);
            awaitJs(scenario, "[...document.querySelectorAll('button')].some(b=>b.getAttribute('aria-label')==='+ Новая запись' && !b.disabled)");
            js(scenario, "[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='+ Новая запись').click()");
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
            js(scenario, "[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='+ Новая запись').click()");
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
            awaitJs(scenario, "!!document.querySelector('[data-catalog=libraries] .catalog-item')");
            assertEquals("false", js(scenario, "!!document.querySelector('[data-editor]')"));
            openDraftCollection(scenario);
            awaitJs(scenario, "[...document.querySelectorAll('button')].some(b=>b.getAttribute('aria-label')==='+ Новая запись' && !b.disabled)");
            assertEquals("false", js(scenario, "!!document.querySelector('[data-editor]')"));
            js(scenario, "[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='+ Новая запись').click()");
            awaitJs(scenario, "document.querySelector('[data-editor] input[aria-label=Название]')?.value==='Android paused draft survives process death'");
            File file = draftFile(draftScope(scenario));
            js(scenario, "[...document.querySelectorAll('[data-editor] button')].find(b=>b.textContent==='Сохранить').click()");
            awaitJs(scenario, "!document.querySelector('[data-editor]')");
            assertFalse("Successful save did not remove the native draft file", file.exists());
            System.out.println("DRAFT_PROCESS passed: native file survived force-stop and was restored only on creation and removed only by Save");
        }
    }
    private void openProfileCollection(ActivityScenario<MainActivity> scenario) throws Exception {
        awaitJs(scenario, "[...document.querySelectorAll('[data-catalog=libraries] .catalog-item')].some(b=>b.textContent.includes('Заметки: профили (dev/CI)'))");
        js(scenario, "[...document.querySelectorAll('[data-catalog=libraries] .catalog-item')].find(b=>b.textContent.includes('Заметки: профили (dev/CI)')).click()");
        awaitJs(scenario, "[...document.querySelectorAll('[data-catalog=collections] .catalog-item')].some(b=>b.querySelector('.catalog-copy strong')?.textContent==='Заметки')");
        js(scenario, "[...document.querySelectorAll('[data-catalog=collections] .catalog-item')].find(b=>b.querySelector('.catalog-copy strong')?.textContent==='Заметки').click()");
        awaitJs(scenario, "!!document.querySelector('.reference-view-chips [aria-pressed=true]') && document.querySelectorAll('.entry').length>0");
    }
    @Test public void namedProfilesShareRecordsAndPersistDefaultAfterRecreation() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            openProfileCollection(scenario);
            js(scenario, "[...document.querySelectorAll('.reference-view-chips button')].find(b=>b.textContent.trim()==='Только Бета').click()");
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
            awaitJs(scenario, "document.querySelector('.reference-view-chips [aria-pressed=true]')?.textContent==='Только Бета' && document.querySelectorAll('.entry').length===1");
        }
    }
    @Test public void creationPresetKeepsDraftAndSavesThroughNativeRepository() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            awaitJs(scenario, "[...document.querySelectorAll('[data-catalog=libraries] .catalog-item')].some(button=>button.textContent.includes('Проекты и задачи (dev/CI)'))");
            js(scenario, "[...document.querySelectorAll('[data-catalog=libraries] .catalog-item')].find(button=>button.textContent.includes('Проекты и задачи (dev/CI)')).click()");
            awaitJs(scenario, "[...document.querySelectorAll('[data-catalog=collections] .catalog-item')].some(button=>button.querySelector('.catalog-copy strong')?.textContent==='Задачи')");
            js(scenario, "[...document.querySelectorAll('[data-catalog=collections] .catalog-item')].find(button=>button.querySelector('.catalog-copy strong')?.textContent==='Задачи').click()");
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
            awaitJs(scenario, "[...document.querySelectorAll('[data-catalog=libraries] .catalog-item')].some(b=>b.textContent.includes('Заметки: строки (dev/CI)'))");
            js(scenario, "[...document.querySelectorAll('[data-catalog=libraries] .catalog-item')].find(b=>b.textContent.includes('Заметки: строки (dev/CI)')).click()");
            awaitJs(scenario, "[...document.querySelectorAll('[data-catalog=collections] .catalog-item')].some(b=>b.querySelector('.catalog-copy strong')?.textContent==='Заметки')");
            js(scenario, "[...document.querySelectorAll('[data-catalog=collections] .catalog-item')].find(b=>b.querySelector('.catalog-copy strong')?.textContent==='Заметки').click()");
            awaitJs(scenario, "[...document.querySelectorAll('button')].some(b=>b.getAttribute('aria-label')==='+ Новая запись' && !b.disabled)");
            js(scenario, "[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='+ Новая запись').click()");
            awaitJs(scenario, "!!document.querySelector('[data-editor] input[aria-label=Название]:not(:disabled)')");
            assertEquals("false", js(scenario, "document.querySelector('[data-editor] details.layout-cell').open"));
            assertEquals("1", js(scenario, "getComputedStyle(document.querySelector('[data-editor] .layout-row')).gridTemplateColumns.split(' ').length"));
            js(scenario, "[...document.querySelectorAll('[data-editor] button')].find(b=>b.textContent==='Сохранить').click()");
            awaitJs(scenario, "document.querySelector('[data-editor] details.layout-cell').open");
            js(scenario, "(()=>{const input=document.querySelector('[data-editor] input[aria-label=Название]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Android layout record');input.dispatchEvent(new Event('input',{bubbles:true}));const text=document.querySelector('[data-editor] textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(text,'**Native rows**');text.dispatchEvent(new Event('input',{bubbles:true}));})()");
            assertEquals("\"0\"", js(scenario, "document.querySelector('[data-editor] input[aria-label=Приоритет]').value"));
            assertEquals("\"false\"", js(scenario, "document.querySelector('[data-editor] select[aria-label=Избранное]').value"));
            js(scenario, "[...document.querySelectorAll('[data-editor] button')].find(b=>b.textContent==='Сохранить').click()");
            awaitJs(scenario, "!document.querySelector('[data-editor]') && [...document.querySelectorAll('.entry')].some(b=>b.textContent.includes('Android layout record'))");
            scenario.recreate();
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            awaitJs(scenario, "[...document.querySelectorAll('[data-catalog=libraries] .catalog-item')].some(b=>b.textContent.includes('Заметки: строки (dev/CI)'))");
            js(scenario, "[...document.querySelectorAll('[data-catalog=libraries] .catalog-item')].find(b=>b.textContent.includes('Заметки: строки (dev/CI)')).click()");
            awaitJs(scenario, "[...document.querySelectorAll('[data-catalog=collections] .catalog-item')].some(b=>b.querySelector('.catalog-copy strong')?.textContent==='Заметки')");
            js(scenario, "[...document.querySelectorAll('[data-catalog=collections] .catalog-item')].find(b=>b.querySelector('.catalog-copy strong')?.textContent==='Заметки').click()");
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
            String profile = js(scenario, "document.querySelector('.reference-view-chips [aria-pressed=true]').value");
            openConstructor(scenario);
            awaitJs(scenario, "[...document.querySelectorAll('button')].some(button=>button.textContent==='Поля' && !button.disabled)");
            js(scenario, "[...document.querySelectorAll('button')].find(button=>button.textContent==='Поля' && !button.disabled).click()");
            awaitJs(scenario, "!!document.querySelector('.field-list button:not(:disabled)')");
            String fieldName = js(scenario, "document.querySelector('.field-list b').textContent");
            js(scenario, "document.querySelector('.field-list button').click()");
            awaitJs(scenario, "!!document.querySelector('.field-properties input:not(:disabled)')");
            js(scenario, "const input=document.querySelector('.field-properties input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Несохранённое имя поля'); input.dispatchEvent(new Event('input',{bubbles:true}))");
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack();
            awaitJs(scenario, "!document.querySelector('.field-properties') && !!document.querySelector('[data-editor] .field-list')");
            assertEquals(fieldName, js(scenario, "document.querySelector('.field-list b').textContent"));
            assertEquals("true", js(scenario, "document.activeElement.matches('.field-list button')"));
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack();
            awaitJs(scenario, "!document.querySelector('[data-editor]') && document.querySelector('#constructor-toggle').getAttribute('aria-pressed')==='true'");
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack();
            awaitJs(scenario, "document.querySelector('#constructor-toggle').getAttribute('aria-pressed')==='false'");
            assertEquals(profile, js(scenario, "document.querySelector('.reference-view-chips [aria-pressed=true]').value"));
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
            js(scenario, "(()=>{const controls=document.querySelectorAll('[data-editor] select'); for(const [i,value] of ['dark','compact','1.5','list'].entries()){controls[i].value=value;controls[i].dispatchEvent(new Event('change',{bubbles:true}));}})()");
            js(scenario, "[...document.querySelectorAll('[data-editor] button')].find(b=>b.textContent==='Сохранить оформление').click()");
            awaitJs(scenario, "!document.querySelector('[data-editor]') && document.documentElement.dataset.theme==='dark'");
            scenario.recreate();
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            awaitJs(scenario, "document.documentElement.dataset.theme==='dark' && document.documentElement.dataset.density==='compact' && parseFloat(getComputedStyle(document.documentElement).fontSize)>=22.4 && !!document.querySelector('[data-catalog=libraries] .catalog-list')");
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
            awaitJs(scenario, "[...document.querySelectorAll('[data-catalog=libraries] .catalog-item')].some(button=>button.textContent.includes('Заметки: Markdown (dev/CI)'))");
            js(scenario, "[...document.querySelectorAll('[data-catalog=libraries] .catalog-item')].find(button=>button.textContent.includes('Заметки: Markdown (dev/CI)')).click()");
            awaitJs(scenario, "[...document.querySelectorAll('[data-catalog=collections] .catalog-item')].some(button=>button.querySelector('.catalog-copy strong')?.textContent==='Заметки')");
            js(scenario, "[...document.querySelectorAll('[data-catalog=collections] .catalog-item')].find(button=>button.querySelector('.catalog-copy strong')?.textContent==='Заметки').click()");
            awaitJs(scenario, "[...document.querySelectorAll('.entry')].some(row=>row.textContent.includes('Native Markdown'))");
            js(scenario, "Reflect.set(window,'nativeMarkdownXss',false); [...document.querySelectorAll('.entry')].find(row=>row.textContent.includes('Native Markdown')).click()");
            awaitJs(scenario, "!!document.querySelector('.detail .markdown strong')");
            assertEquals("\"Безопасно\"", js(scenario, "document.querySelector('.detail .markdown strong').textContent"));
            assertEquals("false", js(scenario, "Reflect.get(window,'nativeMarkdownXss')"));
            assertEquals("0", js(scenario, "document.querySelectorAll('.detail .markdown script,.detail .markdown img').length"));
            assertEquals("true", js(scenario, "document.querySelector('.detail .original-content').textContent.startsWith('# Native Markdown **ёж**')"));
        }
    }
    @Test public void corruptedDraftAllowsCreationAndPreservesItsOriginalFileForRecovery() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            JSONObject scope = new JSONObject((String)new JSONTokener(js(scenario, "document.documentElement.dataset.historyFixture")).nextValue());
            scope.put("dataset_id", draftScope(scenario).getString("dataset_id"));
            File live = draftFile(scope); assertTrue(live.getParentFile().isDirectory() || live.getParentFile().mkdirs());
            byte[] broken = "{broken native draft".getBytes(java.nio.charset.StandardCharsets.UTF_8);
            java.nio.file.Files.write(live.toPath(), broken);
            openCatalogTarget(scenario, "libraries", "Открыть библиотеку «" + scope.getString("library_name") + "»");
            openCatalogTarget(scenario, "collections", "Открыть коллекцию «Редакции»");
            awaitJs(scenario, "!!document.querySelector('.split-button .primary:not(:disabled)')");
            js(scenario, "document.querySelector('.split-button .primary').click()");
            awaitJs(scenario, "!!document.querySelector('[data-draft-recovery]') && !!document.querySelector('[data-editor] input[aria-label=Название]:not(:disabled)')");
            String recoveryPath = (String)new JSONTokener(js(scenario, "document.querySelector('[data-draft-recovery]').getAttribute('data-draft-recovery')")).nextValue();
            assertTrue(recoveryPath.startsWith("draft-recovery/"));
            var context = InstrumentationRegistry.getInstrumentation().getTargetContext();
            File recovered = new File(context.getFilesDir(), "operational/" + recoveryPath);
            assertArrayEquals(broken, java.nio.file.Files.readAllBytes(recovered.toPath()));
            js(scenario, "const input=document.querySelector('[data-editor] input[aria-label=Название]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Android recovered creation');input.dispatchEvent(new Event('input',{bubbles:true}))");
            js(scenario, "[...document.querySelectorAll('[data-editor] button')].find(b=>b.textContent==='Сохранить').click()");
            awaitJs(scenario, "!document.querySelector('[data-editor]') && [...document.querySelectorAll('.entry')].some(b=>b.textContent.includes('Android recovered creation'))");
            assertFalse(live.exists()); assertArrayEquals(broken, java.nio.file.Files.readAllBytes(recovered.toPath()));
            scenario.recreate(); awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            assertArrayEquals(broken, java.nio.file.Files.readAllBytes(recovered.toPath()));
        }
    }
    private void openMenuItem(ActivityScenario<MainActivity> scenario, String region, String action) throws Exception {
        String menu = "document.querySelector(" + JSONObject.quote(region + " button[aria-haspopup=menu]") + ")";
        awaitJs(scenario, "!!" + menu + " && !" + menu + ".disabled");
        js(scenario, menu + ".click()");
        String item = "[...document.querySelectorAll(" + JSONObject.quote(region + " [role=menuitem]:not(:disabled)") +
            ")].find(button=>button.textContent.trim()===" + JSONObject.quote(action) + ")";
        awaitJs(scenario, "!!(" + item + ")");
        js(scenario, "(" + item + ").click()");
    }
    private void openCatalogTarget(ActivityScenario<MainActivity> scenario, String catalog, String label) throws Exception {
        String buttons = "[...document.querySelectorAll('[data-catalog=" + catalog + "] button')]";
        String matches = "b=>b.getAttribute('aria-label')===" + JSONObject.quote(label) + " && !b.disabled";
        awaitJs(scenario, buttons + ".some(" + matches + ")");
        js(scenario, buttons + ".find(" + matches + ").click()");
    }
    @Test public void recordHistoryRestoresAndClearsWithoutLosingCurrentDataAcrossRecreation() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            JSONObject scope = new JSONObject((String)new JSONTokener(js(scenario, "document.documentElement.dataset.historyFixture")).nextValue());
            String libraryButton = "Открыть библиотеку «" + scope.getString("library_name") + "»";
            openCatalogTarget(scenario, "libraries", libraryButton);
            openCatalogTarget(scenario, "collections", "Открыть коллекцию «Редакции»");
            awaitJs(scenario, "[...document.querySelectorAll('.entry')].some(b=>b.textContent.includes('Вторая редакция'))");
            js(scenario, "[...document.querySelectorAll('.entry')].find(b=>b.textContent.includes('Вторая редакция')).click()");
            awaitJs(scenario, "!!document.querySelector('.detail')");
            openMenuItem(scenario, ".detail", "История записи");
            awaitJs(scenario, "document.querySelectorAll('.history-versions button').length===2");
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack();
            awaitJs(scenario, "!document.querySelector('[data-editor]') && document.querySelector('.detail #record-title')?.textContent==='Вторая редакция'");
            openMenuItem(scenario, ".detail", "История записи");
            awaitJs(scenario, "document.querySelectorAll('.history-versions button').length===2");
            js(scenario, "document.querySelector('[data-version-id=\"" + scope.getString("first_version_id") + "\"]').click()");
            awaitJs(scenario, "document.querySelector('.history-snapshot')?.textContent.includes('Текст снимка') && document.querySelector('.history-snapshot').textContent.includes('Конец полного снимка **без усечения**') && !document.querySelector('.history-snapshot script')");
            js(scenario, "[...document.querySelectorAll('[data-editor] button')].find(b=>b.textContent==='Восстановить эту версию').click()");
            awaitJs(scenario, "!document.querySelector('[data-editor]') && document.querySelector('.detail #record-title')?.textContent==='Первая редакция'");
            openMenuItem(scenario, ".detail", "История записи");
            awaitJs(scenario, "document.querySelectorAll('.history-versions button').length===3");
            js(scenario, "[...document.querySelectorAll('[data-editor] button')].find(b=>b.textContent==='Очистить историю записи').click()");
            js(scenario, "[...document.querySelectorAll('[data-editor] button')].find(b=>b.textContent==='Подтвердить очистку истории').click()");
            awaitJs(scenario, "document.querySelector('[data-editor] [role=status]')?.textContent==='Сохранённых версий нет.'");
            scenario.recreate(); awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            openCatalogTarget(scenario, "libraries", libraryButton);
            openCatalogTarget(scenario, "collections", "Открыть коллекцию «Редакции»");
            awaitJs(scenario, "[...document.querySelectorAll('.entry')].some(b=>b.textContent.includes('Первая редакция'))");
            js(scenario, "[...document.querySelectorAll('.entry')].find(b=>b.textContent.includes('Первая редакция')).click()");
            awaitJs(scenario, "!!document.querySelector('.detail')");
            openMenuItem(scenario, ".detail", "История записи");
            awaitJs(scenario, "document.querySelector('[data-editor] [role=status]')?.textContent==='Сохранённых версий нет.'");
        }
    }
    @Test public void sharedTrashRestoresPurgesAndKeepsRetentionAcrossRecreation() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            JSONObject scope = new JSONObject((String)new JSONTokener(js(scenario, "document.documentElement.dataset.historyFixture")).nextValue());
            openCatalogTarget(scenario, "libraries", "Открыть библиотеку «" + scope.getString("library_name") + "»");
            openCatalogTarget(scenario, "collections", "Открыть коллекцию «Редакции»");
            awaitJs(scenario, "[...document.querySelectorAll('.entry:not(:disabled)')].some(b=>b.textContent.includes('Другая запись'))");
            js(scenario, "[...document.querySelectorAll('.entry:not(:disabled)')].find(b=>b.textContent.includes('Другая запись')).click()");
            awaitJs(scenario, "document.querySelector('.detail #record-title')?.textContent==='Другая запись'");
            openMenuItem(scenario, ".detail", "Удалить");
            awaitJs(scenario, "!document.querySelector('.detail') && !document.querySelector('[data-editor]')");
            openMenuItem(scenario, ".workspace-header", "Корзина");
            String item = "document.querySelector('[data-trash-id=\"" + scope.getString("other_id") + "\"]')";
            awaitJs(scenario, "!!" + item + "?.querySelector('button:not(:disabled)')");
            js(scenario, item + ".querySelector('button').click()");
            awaitJs(scenario, "!" + item);
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack();
            awaitJs(scenario, "!document.querySelector('[data-editor]') && [...document.querySelectorAll('.entry:not(:disabled)')].some(b=>b.textContent.includes('Другая запись'))");
            js(scenario, "[...document.querySelectorAll('.entry:not(:disabled)')].find(b=>b.textContent.includes('Другая запись')).click()");
            awaitJs(scenario, "document.querySelector('.detail #record-title')?.textContent==='Другая запись'");
            openMenuItem(scenario, ".detail", "Удалить");
            awaitJs(scenario, "!document.querySelector('.detail') && !document.querySelector('[data-editor]')");
            openMenuItem(scenario, ".workspace-header", "Корзина");
            awaitJs(scenario, "!!" + item + "?.querySelector('button:not(:disabled)')");
            js(scenario, item + ".querySelectorAll('button')[1].click()");
            awaitJs(scenario, "!!document.querySelector('.trash-confirm')");
            String confirmPurgeButton = "[...document.querySelectorAll('.trash-confirm button:not(:disabled)')].find(button=>button.textContent==='Подтвердить окончательное удаление')";
            awaitJs(scenario, "!!(" + confirmPurgeButton + ")");
            js(scenario, "(" + confirmPurgeButton + ").click()");
            awaitJs(scenario, "!" + item);
            awaitJs(scenario, "!!document.querySelector('[data-trash] fieldset select:not(:disabled)')");
            js(scenario, "const select=document.querySelector('[data-trash] fieldset select');select.value='forever';select.dispatchEvent(new Event('change',{bubbles:true}))");
            awaitJs(scenario, "!!document.querySelector('[data-trash] fieldset button:not(:disabled)')");
            js(scenario, "[...document.querySelectorAll('[data-trash] button')].find(b=>b.textContent==='Сохранить срок хранения').click()");
            awaitJs(scenario, "document.querySelector('[data-trash] fieldset select')?.value==='forever' && !document.querySelector('[data-trash] fieldset select').disabled && document.querySelector('[data-trash] fieldset button').disabled");
            scenario.recreate(); awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            openMenuItem(scenario, ".workspace-header", "Корзина");
            awaitJs(scenario, "document.querySelector('[data-trash] fieldset select')?.value==='forever' && !document.querySelector('[data-trash] fieldset select').disabled");
            awaitJs(scenario, "!" + item);
        }
    }
    @Test public void attachmentDraftPublishesOnlyOnSaveAndKeepsNativeBytesAcrossRecreation() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            JSONObject scope = new JSONObject((String)new JSONTokener(js(scenario, "document.documentElement.dataset.attachmentFixture")).nextValue());
            String library = "Открыть библиотеку «" + scope.getString("library_name") + "»";
            openCatalogTarget(scenario, "libraries", library);
            openCatalogTarget(scenario, "collections", "Открыть коллекцию «Материалы с файлами»");
            awaitJs(scenario, "[...document.querySelectorAll('button:not(:disabled)')].some(b=>b.getAttribute('aria-label')==='+ Новая запись')");
            js(scenario, "[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='+ Новая запись').click()");
            awaitJs(scenario, "!!document.querySelector('[data-editor] input[aria-label=Название]:not(:disabled)')");
            js(scenario, "(()=>{const input=document.querySelector('[data-editor] input[aria-label=Название]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Android file draft');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
            js(scenario, "(()=>{const input=document.querySelector('[data-editor] input[type=file][aria-label=Документы]'),transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array([0,255,17,13,10,42])],'Документ.bin',{type:'application/octet-stream'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()");
            awaitJs(scenario, "document.querySelector('[data-editor] [data-attachment-id] .file-state')?.textContent==='Копия на этом устройстве'");
            String id = (String)new JSONTokener(js(scenario, "document.querySelector('[data-editor] [data-attachment-id]').getAttribute('data-attachment-id')")).nextValue();
            File file = new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(), "attachments/" + id.substring(0,2) + "/" + id);
            byte[] bytes = new byte[]{0,(byte)255,17,13,10,42};
            assertArrayEquals(bytes, java.nio.file.Files.readAllBytes(file.toPath()));
            js(scenario, "[...document.querySelectorAll('[data-editor] button')].find(b=>b.textContent==='Закрыть').click()");
            awaitJs(scenario, "!document.querySelector('[data-editor]') && document.querySelectorAll('.entry').length===0");
            scenario.recreate(); awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            openCatalogTarget(scenario, "libraries", library);
            openCatalogTarget(scenario, "collections", "Открыть коллекцию «Материалы с файлами»");
            awaitJs(scenario, "[...document.querySelectorAll('button:not(:disabled)')].some(b=>b.getAttribute('aria-label')==='+ Новая запись')");
            js(scenario, "[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='+ Новая запись').click()");
            awaitJs(scenario, "document.querySelector('[data-editor] input[aria-label=Название]')?.value==='Android file draft' && !!document.querySelector('[data-attachment-id=\"" + id + "\"]')");
            awaitJs(scenario, "[...document.querySelectorAll('[data-editor] button:not(:disabled)')].some(b=>b.textContent==='Сохранить')");
            js(scenario, "[...document.querySelectorAll('[data-editor] button')].find(b=>b.textContent==='Сохранить').click()");
            awaitJs(scenario, "!document.querySelector('[data-editor]') && [...document.querySelectorAll('.entry:not(:disabled)')].some(b=>b.textContent.includes('Android file draft'))");
            js(scenario, "[...document.querySelectorAll('.entry:not(:disabled)')].find(b=>b.textContent.includes('Android file draft')).click()");
            awaitJs(scenario, "document.querySelector('.detail [data-attachment-id=\"" + id + "\"] .file-state')?.textContent==='Копия на этом устройстве'");
            assertArrayEquals(bytes, java.nio.file.Files.readAllBytes(file.toPath()));
            openMenuItem(scenario, ".detail", "История записи");
            awaitJs(scenario, "document.querySelectorAll('.history-versions button').length===1");
        }
    }
    private void openConstructor(ActivityScenario<MainActivity> scenario) throws Exception {
        awaitJs(scenario, "!!document.querySelector('#constructor-toggle:not(:disabled)')");
        if (!"true".equals(js(scenario, "document.querySelector('#constructor-toggle').getAttribute('aria-pressed')==='true'"))) {
            js(scenario, "document.querySelector('#constructor-toggle').click()");
            awaitJs(scenario, "document.querySelector('#constructor-toggle').getAttribute('aria-pressed')==='true'");
        }
    }
    private void configureNavigationStart(ActivityScenario<MainActivity> scenario, JSONObject scope) throws Exception {
        openConstructor(scenario);
        js(scenario, "[...document.querySelectorAll('button')].find(b=>b.textContent==='Стартовый экран библиотеки').click()");
        awaitJs(scenario, "!!document.querySelector('[data-editor] select:not(:disabled)')");
        js(scenario, "const select=document.querySelector('[data-editor] select');select.value='collection';select.dispatchEvent(new Event('change',{bubbles:true}))");
        awaitJs(scenario, "document.querySelectorAll('[data-editor] select').length===4 && [...document.querySelectorAll('[data-editor] select')[2].options].some(o=>o.text==='Стартовый профиль')");
        js(scenario, "const profile=document.querySelectorAll('[data-editor] select')[2];profile.value=" + JSONObject.quote(scope.getString("profile_id")) + ";profile.dispatchEvent(new Event('change',{bubbles:true}));const layout=document.querySelectorAll('[data-editor] select')[3];layout.value='list';layout.dispatchEvent(new Event('change',{bubbles:true}))");
        js(scenario, "[...document.querySelectorAll('[data-editor] button')].find(b=>b.textContent==='Сохранить').click()");
        awaitJs(scenario, "!document.querySelector('[data-editor]') && !document.querySelector('#constructor-toggle').disabled");
        js(scenario, "document.querySelector('#constructor-toggle').click()");
        awaitJs(scenario, "document.querySelector('#constructor-toggle').getAttribute('aria-pressed')==='false'");
    }
    @Test public void libraryShortcutIntentOpensConfiguredStartAndWaitsForCreationForm() throws Exception {
        var context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        JSONObject scope;
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            scope = new JSONObject((String)new JSONTokener(js(scenario, "document.documentElement.dataset.navigationFixture")).nextValue());
            openCatalogTarget(scenario, "libraries", "Открыть библиотеку «Навигация (dev/CI)»");
            awaitJs(scenario, "!document.querySelector('#constructor-toggle').disabled && document.querySelector('h1')?.textContent!=='Библиотеки'");
            configureNavigationStart(scenario, scope);
            js(scenario, "[...document.querySelectorAll('.topbar button')].find(b=>b.textContent==='Все библиотеки').click()");
            awaitJs(scenario, "!!document.querySelector('[data-catalog=libraries]')");
            var intent = ExternalActionsPlugin.libraryIntent(context, scope.getString("library_id"));
            assertEquals(scope.getString("library_id"), intent.getStringExtra("tessera.library_id"));
            // Exercise the actual onNewIntent callback without launching another task.
            // Keep the ActivityScenario's initial Intent: ExternalActionsPlugin sets a
            // new OPEN_LIBRARY Intent on the Activity, but AndroidX ActivityScenario
            // identifies lifecycle callbacks by matching action/data/categories.
            // Restoring the original Intent at teardown lets it observe DESTROYED.
            final AtomicReference<android.content.Intent> scenarioIntent = new AtomicReference<>();
            scenario.onActivity(activity -> {
                scenarioIntent.set(new android.content.Intent(activity.getIntent()));
                InstrumentationRegistry.getInstrumentation()
                    .callActivityOnNewIntent(activity, new android.content.Intent(intent));
            });
            awaitJs(scenario, "document.querySelector('.reference-view-chips [aria-pressed=true]')?.value===" + JSONObject.quote(scope.getString("profile_id")));
            awaitJs(scenario, "[...document.querySelectorAll('button')].some(b=>b.getAttribute('aria-label')==='+ Новая запись' && !b.disabled)");
            js(scenario, "[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='+ Новая запись').click()");
            awaitJs(scenario, "!!document.querySelector('[data-editor] input[aria-label=Название]:not(:disabled)')");
            js(scenario, "const input=document.querySelector('[data-editor] input[aria-label=Название]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Shortcut preserves creation draft');input.dispatchEvent(new Event('input',{bubbles:true}))");
            scenario.onActivity(activity -> InstrumentationRegistry.getInstrumentation()
                .callActivityOnNewIntent(activity, new android.content.Intent(intent)));
            awaitJs(scenario, "document.body.innerText.includes('Библиотека из ярлыка откроется после закрытия текущей формы.')");
            assertEquals("\"Shortcut preserves creation draft\"", js(scenario, "document.querySelector('[data-editor] input[aria-label=Название]').value"));
            js(scenario, "document.querySelector('[data-editor] .editor-heading button').click()");
            awaitJs(scenario, "!document.querySelector('[data-editor]') && !document.body.innerText.includes('Библиотека из ярлыка откроется') && [...document.querySelectorAll('button')].some(b=>b.getAttribute('aria-label')==='+ Новая запись' && !b.disabled)");
            js(scenario, "[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='+ Новая запись').click()");
            awaitJs(scenario, "document.querySelector('[data-editor] input[aria-label=Название]')?.value==='Shortcut preserves creation draft'");
            js(scenario, "document.querySelector('[data-editor] .editor-heading button').click()");
            awaitJs(scenario, "!document.querySelector('[data-editor]')");
            scenario.onActivity(activity -> {
                assertNotNull("ActivityScenario launcher Intent must be recorded", scenarioIntent.get());
                assertEquals("Shortcut re-entry should update the Activity Intent",
                    context.getPackageName() + ".OPEN_LIBRARY", activity.getIntent().getAction());
                activity.setIntent(scenarioIntent.get());
            });
        }
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(ExternalActionsPlugin.libraryIntent(context, scope.getString("library_id")))) {
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            awaitJs(scenario, "document.querySelector('.reference-view-chips [aria-pressed=true]')?.value===" + JSONObject.quote(scope.getString("profile_id")));
            assertEquals("false", js(scenario, "!!document.querySelector('[data-editor]')"));
            scenario.recreate(); awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            awaitJs(scenario, "!!document.querySelector('[data-catalog=libraries]') && !document.querySelector('[data-editor]')");
        }
    }
    @Test public void catalogsAndLibraryStartSurviveNativeBackAndRecreation() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            assertEquals("true", js(scenario, "!!document.querySelector('[data-catalog=libraries]') && !document.querySelector('[data-editor]')"));
            JSONObject scope = new JSONObject((String)new JSONTokener(js(scenario, "document.documentElement.dataset.navigationFixture")).nextValue());
            openCatalogTarget(scenario, "libraries", "Открыть библиотеку «Навигация (dev/CI)»");
            awaitJs(scenario, "!document.querySelector('#constructor-toggle').disabled && document.querySelector('h1')?.textContent!=='Библиотеки'");
            // Other native cases intentionally retain the chosen start across recreation.
            js(scenario, "[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='К коллекциям')?.click()");
            awaitJs(scenario, "!!document.querySelector('[data-catalog=collections]') && [...document.querySelectorAll('[data-catalog=collections] button')].some(b=>b.textContent.includes('Раздел') && !b.disabled)");
            openConstructor(scenario);
            js(scenario, "[...document.querySelectorAll('button')].find(b=>b.textContent==='Стартовый экран библиотеки').click()");
            awaitJs(scenario, "document.querySelectorAll('[data-editor] select').length>=2");
            js(scenario, "const select=document.querySelector('[data-editor] select');select.value='collection';select.dispatchEvent(new Event('change',{bubbles:true}))");
            awaitJs(scenario, "document.querySelectorAll('[data-editor] select').length===4 && [...document.querySelectorAll('[data-editor] select')[2].options].some(o=>o.text==='Стартовый профиль')");
            js(scenario, "const profile=document.querySelectorAll('[data-editor] select')[2];profile.value=" + JSONObject.quote(scope.getString("profile_id")) + ";profile.dispatchEvent(new Event('change',{bubbles:true}));const layout=document.querySelectorAll('[data-editor] select')[3];layout.value='list';layout.dispatchEvent(new Event('change',{bubbles:true}))");
            js(scenario, "[...document.querySelectorAll('[data-editor] button')].find(b=>b.textContent==='Сохранить').click()");
            awaitJs(scenario, "!document.querySelector('[data-editor]') && !!document.querySelector('[data-catalog=collections] .catalog-list') && !document.querySelector('#constructor-toggle').disabled");
            js(scenario, "document.querySelector('#constructor-toggle').click()");
            awaitJs(scenario, "document.querySelector('#constructor-toggle').getAttribute('aria-pressed')==='false'");
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack();
            awaitJs(scenario, "!!document.querySelector('[data-catalog=libraries]')");
            openCatalogTarget(scenario, "libraries", "Открыть библиотеку «Навигация (dev/CI)»");
            awaitJs(scenario, "document.querySelector('.reference-view-chips [aria-pressed=true]')?.value===" + JSONObject.quote(scope.getString("profile_id")));
            awaitJs(scenario, "!!document.querySelector('.entry:not(:disabled)')");
            js(scenario, "document.querySelector('button[aria-label=\"Варианты создания\"]').click()");
            awaitJs(scenario, "!!document.querySelector('[role=menu]')");
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack();
            awaitJs(scenario, "!document.querySelector('[role=menu]') && !!document.querySelector('.entry') && !document.querySelector('[data-catalog=collections]')");
            js(scenario, "document.querySelector('.entry').click()"); awaitJs(scenario, "!!document.querySelector('.detail')");
            UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
            device.pressBack(); awaitJs(scenario, "!document.querySelector('.detail') && !!document.querySelector('.entry')");
            device.pressBack(); awaitJs(scenario, "!!document.querySelector('[data-catalog=collections]')");
            device.pressBack(); awaitJs(scenario, "!!document.querySelector('[data-catalog=libraries]')");
            scenario.recreate(); awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            assertEquals("true", js(scenario, "!!document.querySelector('[data-catalog=libraries]') && !document.querySelector('[data-editor]')"));
            openCatalogTarget(scenario, "libraries", "Открыть библиотеку «Навигация (dev/CI)»");
            awaitJs(scenario, "document.querySelector('.reference-view-chips [aria-pressed=true]')?.value===" + JSONObject.quote(scope.getString("profile_id")));
        }
    }
    @Test public void explicitSaveKeepsDeepNativeListAndProfile() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitJs(scenario, "document.documentElement.dataset.acceptance === 'passed'", 900);
            openCatalogTarget(scenario, "libraries", "Открыть библиотеку «База знаний (dev/CI)»");
            openCatalogTarget(scenario, "collections", "Открыть коллекцию «Материалы»");
            awaitJs(scenario, "document.querySelector('.list-meta')?.textContent==='Загружено записей: 100'");
            for (int count : new int[]{200, 250}) {
                js(scenario, "[...document.querySelectorAll('button')].find(b=>b.textContent==='Показать ещё').click()");
                awaitJs(scenario, "document.querySelector('.list-meta')?.textContent==='Загружено записей: " + count + "'");
            }
            js(scenario, "document.querySelector('.entry-scroll').scrollTop=document.querySelector('.entry').getBoundingClientRect().height*219");
            awaitJs(scenario, "[...document.querySelectorAll('.entry')].some(b=>b.textContent.includes('Материал 220'))");
            String offset = js(scenario, "document.querySelector('.entry-scroll').scrollTop");
            String profile = js(scenario, "document.querySelector('.reference-view-chips [aria-pressed=true]').value");
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
            assertEquals(profile, js(scenario, "document.querySelector('.reference-view-chips [aria-pressed=true]').value"));
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
            awaitJs(scenario, "!!document.querySelector('[data-catalog=libraries] .catalog-item')");
            js(scenario, "[...document.querySelectorAll('[data-catalog=libraries] .catalog-item')].find(b=>b.textContent.includes('Контракт')).click()");
            awaitJs(scenario, "[...document.querySelectorAll('[data-catalog=collections] .catalog-item')].some(b=>b.querySelector('.catalog-copy strong')?.textContent==='Записи')");
            js(scenario, "[...document.querySelectorAll('[data-catalog=collections] .catalog-item')].find(b=>b.querySelector('.catalog-copy strong')?.textContent==='Записи').click()");
            awaitJs(scenario, "[...document.querySelectorAll('.entry')].some(b=>b.textContent.includes('Bridge roundtrip'))");
            js(scenario, "[...document.querySelectorAll('.entry')].find(b=>b.textContent.includes('Bridge roundtrip')).click()");
            awaitJs(scenario, "!!document.querySelector('.detail #record-title')");
            assertEquals("\"Bridge roundtrip\"", js(scenario, "document.querySelector('.detail #record-title').textContent"));
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack();
            awaitJs(scenario, "!document.querySelector('.detail')");
            // Real ACTION_CREATE_DOCUMENT, real DocumentsUI, real UTF-8 file on disk.
            UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
            device.executeShellCommand("rm -f /sdcard/Download/Tessera-acceptance.csv");
            openMenuItem(scenario, ".workspace-header", "CSV");
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
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack();
            awaitJs(scenario, "!!document.querySelector('[data-catalog=collections]')");
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack();
            awaitJs(scenario, "!!document.querySelector('[data-catalog=libraries]')");
            openCatalogTarget(scenario, "libraries", "Открыть библиотеку «Связи этапа 3»");
            awaitJs(scenario, "[...document.querySelectorAll('[data-catalog=collections] .catalog-item')].some(b=>b.querySelector('.catalog-copy strong')?.textContent==='Проекты')");
            js(scenario, "[...document.querySelectorAll('[data-catalog=collections] .catalog-item')].find(b=>b.querySelector('.catalog-copy strong')?.textContent==='Проекты').click()");
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
