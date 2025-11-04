import { register } from '@snapshot-labs/checkpoint/dist/src/register';
import { createPublicClient, http } from 'viem';
import { config } from '.';

export interface Space {
  id: string;
  expiration: number;
}

export interface CategorizedSpaces {
  expired: Space[];
  expiring: Space[];
}

async function getLatestBlockNumber(): Promise<number> {
  const client = createPublicClient({
    transport: http(config.network_node_url)
  });

  const blockNumber = await client.getBlockNumber();
  return Number(blockNumber);
}

export async function getExpiringSpaces(): Promise<CategorizedSpaces> {
  try {
    const db = register.getKnex();
    const now = ~~(Date.now() / 1e3);
    const oneDaySeconds = 24 * 60 * 60;

    const sevenDaysAgo = now - 7 * oneDaySeconds;
    const sevenDaysFromNow = now + 7 * oneDaySeconds;

    const spaces = await db('spaces')
      .select('id', 'turbo_expiration')
      .whereBetween('turbo_expiration', [sevenDaysAgo, sevenDaysFromNow])
      .distinctOn('id')
      .orderByRaw('id, upper_inf(block_range) DESC, upper(block_range) DESC');

    const allSpaces: Space[] = spaces
      .map(space => ({
        id: space.id,
        expiration: space.turbo_expiration
      }))
      .sort((a, b) => a.expiration - b.expiration);

    const expired = allSpaces.filter(space => space.expiration < now);
    const expiring = allSpaces.filter(space => space.expiration >= now);

    return { expired, expiring };
  } catch (error) {
    console.error('Error getting categorized spaces:', error);
    return { expired: [], expiring: [] };
  }
}

export async function checkIfInSync(syncThresholdBlocks: number): Promise<boolean> {
  try {
    const db = register.getKnex();
    const indexerName = process.env.INDEX_TESTNET ? 'sep' : 'eth';

    const result = await db('_metadatas')
      .where('id', 'last_indexed_block')
      .andWhere('indexer', indexerName)
      .first();

    if (!result?.value) {
      console.log('No indexed blocks yet, skipping expiration check...');
      return false;
    }

    const lastIndexedBlock = parseInt(result.value);
    const latestBlock = await getLatestBlockNumber();
    const blocksBehind = latestBlock - lastIndexedBlock;

    if (lastIndexedBlock > 0 && blocksBehind <= syncThresholdBlocks) {
      return true;
    }

    console.log(`Not in sync (${blocksBehind} blocks behind), skipping expiration check...`);
    return false;
  } catch (error: any) {
    console.log('Error checking sync status:', error?.message || error);
    return false;
  }
}
