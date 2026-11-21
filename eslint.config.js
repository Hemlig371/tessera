import js from '@eslint/js';
import ts from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
export default ts.config(
  { ignores: ['dist/**', 'node_modules/**', 'android/**', '**/target/**', 'work/**', 'test-results/**', 'playwright-report/**', 'src/vendor/qrcodegen.ts'] },
  js.configs.recommended, ...ts.configs.recommended,
  { files: ['src/**/*.tsx'], plugins: { 'react-hooks': hooks }, rules: { ...hooks.configs.recommended.rules } },
  { files: ['scripts/**/*.mjs'], languageOptions: { globals: { process: 'readonly', console: 'readonly', setTimeout: 'readonly', fetch: 'readonly', AbortSignal: 'readonly' } } },
);
