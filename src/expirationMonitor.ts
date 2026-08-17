import Checkpoint, { CheckpointConfig } from '@snapshot-labs/checkpoint';
import { createPublicClient, http, PublicClient } from 'viem';
import {
  hasAlertWebhook,
  sendExpirationNotification,
  sendIndexerRecoveryNotification,
  sendIndexerStallNotification
} from './discord';
import { getExpiringSpaces, getLatestIndexedBlock } from './queries';
import { sleep } from './utils';

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const EXPIRATION_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 day
const SYNC_THRESHOLD_BLOCKS = 200; // Number of blocks to consider indexer in sync
const STALL_ALERT_AFTER_MS = 15 * 60 * 1000;
const BEHIND_ALERT_AFTER_MS = 30 * 60 * 1000;
const REALERT_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function getChainHead(client: PublicClient): Promise<number | null> {
  try {
    return Number(await client.getBlockNumber());
  } catch (err) {
    console.error('Error getting chain head:', err);
    return null;
  }
}

export async function startExpirationMonitor(
  checkpoint: Checkpoint,
  config: CheckpointConfig
): Promise<void> {
  if (!hasAlertWebhook()) {
    console.log(
      'DISCORD_EXPIRATION_WEBHOOK_URL and DISCORD_ALERT_WEBHOOK_URL not set, skipping expiration monitor'
    );
    return;
  }

  const { knex } = checkpoint.getBaseContext();
  const client = createPublicClient({
    transport: http(config.network_node_url)
  });

  let highestIndexedBlock: number | null = null;
  let sawAdvance = false;
  let advancedAt = Date.now();
  let behindSince: number | null = null;
  let alertedAt: number | null = null;
  let nextExpirationCheckAt = 0;

  while (true) {
    try {
      const now = Date.now();
      const lastIndexedBlock = await getLatestIndexedBlock(knex);
      const latestBlock = await getChainHead(client);
      const blocksBehind =
        lastIndexedBlock === null || latestBlock === null
          ? null
          : latestBlock - lastIndexedBlock;

      if (lastIndexedBlock !== null) {
        if (highestIndexedBlock === null) {
          highestIndexedBlock = lastIndexedBlock;
          advancedAt = now;
        } else if (lastIndexedBlock > highestIndexedBlock) {
          highestIndexedBlock = lastIndexedBlock;
          advancedAt = now;
          sawAdvance = true;
        }
      }

      if (blocksBehind !== null) {
        if (blocksBehind <= SYNC_THRESHOLD_BLOCKS) behindSince = null;
        else if (behindSince === null) behindSince = now;
      }

      const stalled = now - advancedAt >= STALL_ALERT_AFTER_MS;
      const losingGround =
        behindSince !== null && now - behindSince >= BEHIND_ALERT_AFTER_MS;

      if (stalled || losingGround) {
        const realertDue =
          alertedAt === null || now - alertedAt >= REALERT_INTERVAL_MS;

        if (realertDue) {
          const delivered = await sendIndexerStallNotification({
            lastIndexedBlock: highestIndexedBlock,
            latestBlock,
            stalledSince: Math.floor(advancedAt / 1e3),
            stalled
          });
          if (delivered) alertedAt = now;
        }
      } else if (
        alertedAt !== null &&
        sawAdvance &&
        highestIndexedBlock !== null &&
        blocksBehind !== null &&
        blocksBehind <= SYNC_THRESHOLD_BLOCKS
      ) {
        alertedAt = null;
        await sendIndexerRecoveryNotification(highestIndexedBlock, latestBlock);
      }

      if (blocksBehind === null) {
        console.log('Sync state unknown, skipping expiration check...');
      } else if (blocksBehind > SYNC_THRESHOLD_BLOCKS) {
        console.log(
          `Not in sync (${blocksBehind} blocks behind), skipping expiration check...`
        );
      } else if (now >= nextExpirationCheckAt) {
        nextExpirationCheckAt = now + EXPIRATION_CHECK_INTERVAL_MS;

        const { expired, expiring } = await getExpiringSpaces(knex);
        if (expired.length > 0 || expiring.length > 0) {
          await sendExpirationNotification({ expired, expiring });
        }
      }
    } catch (err) {
      console.error('Expiration monitor iteration failed:', err);
    }

    await sleep(CHECK_INTERVAL_MS);
  }
}
