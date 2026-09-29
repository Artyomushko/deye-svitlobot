import { getDeviceData } from './deye.js';

// Спільна логіка для всіх платформ: перевірити мережу й пінгнути світлобот.
export async function check(env) {
  const device = await getDeviceData(env);
  const item = device.dataList?.find((d) => d.key === env.GRID_KEY);
  if (!item) throw new Error(`Ключ ${env.GRID_KEY} не знайдено. Запустіть npm run discover`);

  const value = parseFloat(item.value);
  const gridOn = value > parseFloat(env.GRID_MIN);
  console.log(`${env.GRID_KEY}=${value}${item.unit ?? ''} -> ${gridOn ? 'мережа є' : 'мережі немає'}`);

  if (!gridOn) return; // світлобот сам побачить відсутність пінгів

  const res = await fetch(
    `https://api.svitlobot.in.ua/channelPing?channel_key=${encodeURIComponent(env.SVITLOBOT_CHANNEL_KEY)}`,
  );
  console.log(`svitlobot ping: ${res.status}`);
}

// Значення за замовчуванням для платформ без wrangler.toml [vars].
export function envWithDefaults(env) {
  return {
    DEYE_BASE_URL: 'https://eu1-developer.deyecloud.com/v1.0',
    GRID_KEY: 'GridVoltageL1L2',
    GRID_MIN: '100',
    ...env,
  };
}
