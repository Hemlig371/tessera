package app.tessera.personal;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ImportFilesPlugin.class);
        registerPlugin(CsvFilesPlugin.class);
        registerPlugin(BinaryFilesPlugin.class);
        registerPlugin(LocalFilesPlugin.class);
        registerPlugin(ExternalActionsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
