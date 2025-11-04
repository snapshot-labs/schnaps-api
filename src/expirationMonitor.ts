import { sleep } from './utils';
import { getExpiringSpaces, checkIfInSync } from './queries';
import { sendExpirationNotification } from './discord';

const IN_SYNC_CHECK_INTERVAL_MS = 24 * 36e5; // 1 day
const OUT_OF_SYNC_CHECK_INTERVAL_MS = 10 * 6e4; // 10 minutes
const SYNC_THRESHOLD_BLOCKS = 200; // Number of blocks to consider indexer in sync

export async function startExpirationMonitor(): Promise<void> {
  if (!process.env.DISCORD_EXPIRATION_WEBHOOK_URL) {
    console.log('DISCORD_EXPIRATION_WEBHOOK_URL not set, skipping expiration monitor');
    return;
  }

  while (true) {
    const inSync = await checkIfInSync(SYNC_THRESHOLD_BLOCKS);

    if (inSync) {
      const { expired, expiring } = await getExpiringSpaces();
      if (expired.length > 0 || expiring.length > 0) {
        await sendExpirationNotification({ expired, expiring });
      }
    }

    await sleep(inSync ? IN_SYNC_CHECK_INTERVAL_MS : OUT_OF_SYNC_CHECK_INTERVAL_MS);
  }
}
