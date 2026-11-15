package app.tessera.personal;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CsvFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
