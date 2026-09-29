import { cloudEvent } from '@google-cloud/functions-framework';
import { check, envWithDefaults } from '../src/check.js';

// GCP Cloud Functions (2nd gen): запускається Cloud Scheduler -> Pub/Sub щохвилини.
cloudEvent('deyeSvitlobot', async () => {
  try {
    await check(envWithDefaults(process.env));
  } catch (e) {
    console.error(e.message);
  }
});
