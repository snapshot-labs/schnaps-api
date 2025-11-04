import { sleep } from './utils';
import { getExpiringSpaces, checkIfInSync } from './queries';
import { sendExpirationNotification } from './discord';

const IN_SYNC_CHECK_INTERVAL_MS = 24 * 36e5; // 1 day
const SYNC_THRESHOLD_BLOCKS = 200; // Number of blocks to consider indexer in sync

export async function startExpirationMonitor(): Promise<void> {
  if (!process.env.DISCORD_WEBHOOK_URL)
    return console.log('DISCORD_WEBHOOK_URL not set, skipping expiration monitor');

  while (true) {
    const inSync = await checkIfInSync(SYNC_THRESHOLD_BLOCKS);

    if (inSync) {
      const { expired, expiring } = await getExpiringSpaces();
      if (expired.length > 0 || expiring.length > 0) {
        await sendExpirationNotification({ expired, expiring });
      }
    }

    // if in sync, wait for a day before next check, else wait for 10 minutes
    await sleep(inSync ? IN_SYNC_CHECK_INTERVAL_MS : 10 * 6e4);
  }
}
