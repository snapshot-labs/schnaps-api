import { sleep } from './utils';
import { getCategorizedSpaces, checkIfInSync } from './queries';
import { sendExpirationNotification } from './discord';

const EXPIRATION_CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const SYNC_THRESHOLD_BLOCKS = 200; // Number of blocks to consider indexer in sync

export async function startExpirationMonitor(): Promise<void> {
  if (!process.env.DISCORD_WEBHOOK_URL)
    return console.log('DISCORD_WEBHOOK_URL not set, skipping expiration monitor');

  while (true) {
    const inSync = await checkIfInSync(SYNC_THRESHOLD_BLOCKS);
    if (inSync) {
      const categorizedSpaces = await getCategorizedSpaces();

      if (categorizedSpaces.expired.length > 0 || categorizedSpaces.expiring.length > 0) {
        await sendExpirationNotification(categorizedSpaces);
      }
    }

    await sleep(EXPIRATION_CHECK_INTERVAL_MS);
  }
}
