import { spawnSync } from 'node:child_process';
const windows = process.platform === 'win32';
const command = windows ? 'gradlew.bat' : './gradlew';
const result = spawnSync(command, process.argv.slice(2), { cwd: 'android', stdio: 'inherit', shell: windows });
process.exit(result.status ?? 1);
