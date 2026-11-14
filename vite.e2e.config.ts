import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';
import { e2ePlugin } from './tests/support/e2e-plugin';
export default mergeConfig(base, defineConfig({ plugins: [e2ePlugin()] }));
