import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'app.tessera.personal', appName: 'Tessera', webDir: 'dist',
  android: { allowMixedContent: false },
  plugins: {
    CapacitorSQLite: { androidIsEncryption: false },
    // Capacitor 8 supplies Android system/cutout insets as --safe-area-inset-*;
    // avoid a second native padding layer that doubles Fold safe areas.
    SystemBars: { insetsHandling: 'css', style: 'DEFAULT', hidden: false },
  },
};
export default config;
