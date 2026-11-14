import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';
export default mergeConfig(base, defineConfig({
  plugins: [{ name: 'android-acceptance-entry', transformIndexHtml: { order: 'pre', handler: html => html.replace('/src/main.tsx', '/tests/support/android-main.tsx') } }],
}));
