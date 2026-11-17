package app.tessera.personal;

import android.content.Context;
import java.util.ArrayList;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.community.database.sqlite.SQLite.Database;
import java.util.Hashtable;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Abandoned transactions roll back and release locks; explicit commits survive close/reopen. */
@RunWith(AndroidJUnit4.class)
public class SqliteLifecycleTest {
    private Database open(Context context, String name) throws Exception {
        Database database = new Database(context, name, false, "no-encryption", 1, false, new Hashtable<>(), null, false);
        database.open();
        return database;
    }
    private int rows(Database database) throws Exception {
        return database.selectSQL("SELECT count(*) AS n FROM lifecycle_probe", new ArrayList<>()).getJSONObject(0).getInt("n");
    }
    @Test public void closingAbandonedTransactionRollsBackAndReleasesItsWriteLock() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String name = "lifecycle-" + System.nanoTime() + "SQLite.db";
        Database database = open(context, name);
        try {
            database.execute(new String[]{"CREATE TABLE lifecycle_probe(value TEXT NOT NULL)"}, false);
            database.beginTransaction();
            database.execute(new String[]{"INSERT INTO lifecycle_probe VALUES('uncommitted')"}, false);
            database.close();
            database = open(context, name);
            assertEquals("Abandoned writes must roll back", 0, rows(database));
            database.beginTransaction();
            database.execute(new String[]{"INSERT INTO lifecycle_probe VALUES('committed')"}, false);
            database.commitTransaction(); database.close();
            database = open(context, name);
            assertEquals("Explicit commits must survive disposal", 1, rows(database));
        } finally {
            if (database.isOpen()) database.close();
            context.deleteDatabase(name);
        }
    }
}
