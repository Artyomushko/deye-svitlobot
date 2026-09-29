// Локально показує всі показники пристрою, щоб вибрати GRID_KEY.
// Використання: заповніть .dev.vars і запустіть `npm run discover`.
import { getDeviceData } from '../src/deye.js';

const env = { ...process.env, DEYE_BASE_URL: process.env.DEYE_BASE_URL ?? 'https://eu1-developer.deyecloud.com/v1.0' };
const d = await getDeviceData(env);
console.log('state:', d.deviceState);
for (const i of d.dataList) console.log(`${i.key.padEnd(32)} ${String(i.value).padStart(10)} ${i.unit ?? ''}  ${i.name ?? ''}`);
