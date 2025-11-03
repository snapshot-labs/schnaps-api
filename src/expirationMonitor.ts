import { sleep } from './utils';
import { getExpiringSpacesForNotification, checkIfInSync } from './queries';
import { notifyExpiringSpaces } from './discord';

const EXPIRATION_CHECK_INTERVAL_MS = 10 * 6e4; // 10 minutes
const SYNC_THRESHOLD_BLOCKS = 200; // Consider synced if within 200 blocks of latest

export const NOTIFICATION_CONFIG = {
  1: { emoji: '⚠️' },
  7: { emoji: '📅' }
} as const;

export const NOTIFICATION_DAYS = Object.keys(NOTIFICATION_CONFIG).map(Number);

const notifiedSpaces = new Set<string>();

export async function startExpirationMonitor(): Promise<void> {
  if (!process.env.DISCORD_WEBHOOK_URL)
    return console.log('DISCORD_WEBHOOK_URL not set, skipping expiration monitor');

  while (true) {
    try {
      const inSync = await checkIfInSync(SYNC_THRESHOLD_BLOCKS);
      if (inSync) {
        await checkExpiringSpaces();
      }
    } catch (error) {
      console.error('Error in expiration monitor:', error);
    }

    await sleep(EXPIRATION_CHECK_INTERVAL_MS);
  }
}

export async function checkExpiringSpaces(): Promise<void> {
  const expiringSpaces = await getExpiringSpacesForNotification(NOTIFICATION_DAYS);

  const newExpiringSpaces = expiringSpaces.filter(space => !notifiedSpaces.has(space.key));

  if (newExpiringSpaces.length > 0) {
    try {
      await notifyExpiringSpaces(newExpiringSpaces);

      newExpiringSpaces.forEach(space => notifiedSpaces.add(space.key));
      console.log(
        `Notified about ${newExpiringSpaces.length} new expiring spaces: ${newExpiringSpaces
          .map(s => s.id)
          .join(', ')}`
      );
    } catch (error) {
      console.error('Failed to notify expiring spaces:', error);
    }
  }
}
