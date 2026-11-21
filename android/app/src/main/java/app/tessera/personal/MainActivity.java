package app.tessera.personal;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ImportFilesPlugin.class);
        registerPlugin(CsvFilesPlugin.class);
        registerPlugin(BinaryFilesPlugin.class);
        registerPlugin(LocalFilesPlugin.class);
        registerPlugin(ExternalActionsPlugin.class);
        registerPlugin(DeviceAuthPlugin.class);
        registerPlugin(SyncSecretsPlugin.class);
        registerPlugin(SyncMailPlugin.class);
        registerPlugin(SyncQrPlugin.class);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE); // Hide sensitive previews in recent apps.
        super.onCreate(savedInstanceState);
    }
}
