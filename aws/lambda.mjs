import { check, envWithDefaults } from '../src/check.js';

// AWS Lambda: запускається за EventBridge (rate(1 minute)).
export const handler = async () => {
  try {
    await check(envWithDefaults(process.env));
  } catch (e) {
    console.error(e.message);
  }
};
