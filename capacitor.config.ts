import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'app.tessera.personal', appName: 'Tessera', webDir: 'dist',
  android: { allowMixedContent: false },
  plugins: { CapacitorSQLite: { androidIsEncryption: false } },
};
export default config;
