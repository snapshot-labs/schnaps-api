import { CheckpointConfig } from '@snapshot-labs/checkpoint';
import { createPublicClient, http } from 'viem';
import { sendExpirationNotification } from './discord';
import { getExpiringSpaces, getLatestIndexedBlock } from './queries';
import { sleep } from './utils';

const IN_SYNC_CHECK_INTERVAL_MS = 24 * 36e5; // 1 day
const OUT_OF_SYNC_CHECK_INTERVAL_MS = 10 * 6e4; // 10 minutes
const SYNC_THRESHOLD_BLOCKS = 200; // Number of blocks to consider indexer in sync

export async function startExpirationMonitor(
  config: CheckpointConfig
): Promise<void> {
  if (!process.env.DISCORD_EXPIRATION_WEBHOOK_URL) {
    console.log(
      'DISCORD_EXPIRATION_WEBHOOK_URL not set, skipping expiration monitor'
    );
    return;
  }

  const client = createPublicClient({
    transport: http(config.network_node_url)
  });

  while (true) {
    const lastIndexedBlock = await getLatestIndexedBlock();
    const latestBlock = Number(await client.getBlockNumber());
    const blocksBehind = latestBlock - lastIndexedBlock;
    const inSync = blocksBehind <= SYNC_THRESHOLD_BLOCKS;

    if (!inSync) {
      console.log(
        `Not in sync (${blocksBehind} blocks behind), skipping expiration check...`
      );
    } else {
      const { expired, expiring } = await getExpiringSpaces();
      if (expired.length > 0 || expiring.length > 0) {
        await sendExpirationNotification({ expired, expiring });
      }
    }

    await sleep(
      inSync ? IN_SYNC_CHECK_INTERVAL_MS : OUT_OF_SYNC_CHECK_INTERVAL_MS
    );
  }
}
