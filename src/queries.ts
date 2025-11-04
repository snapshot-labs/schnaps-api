import { register } from '@snapshot-labs/checkpoint/dist/src/register';
import { getLatestBlockNumber } from './utils';

export interface Space {
  id: string;
  expiration: number;
}

export interface CategorizedSpaces {
  expired: Space[];
  expiring: Space[];
}

export async function getExpiringSpaces(): Promise<CategorizedSpaces> {
  try {
    const db = register.getKnex();
    const now = ~~(Date.now() / 1e3);
    const sevenDays = 7 * 24 * 60 * 60;

    const spaces = await db('spaces')
      .select('id', 'turbo_expiration')
      .whereBetween('turbo_expiration', [now - sevenDays, now + sevenDays])
      .distinctOn('id')
      .orderByRaw('id, upper_inf(block_range) DESC, upper(block_range) DESC');

    const allSpaces: Space[] = spaces
      .map(space => ({
        id: space.id,
        expiration: space.turbo_expiration
      }))
      .sort((a, b) => a.expiration - b.expiration);

    return {
      expired: allSpaces.filter(space => space.expiration < now),
      expiring: allSpaces.filter(space => space.expiration >= now)
    };
  } catch (error) {
    console.error('Error getting expiring spaces:', error);
    return { expired: [], expiring: [] };
  }
}

export async function checkIfInSync(
  syncThresholdBlocks: number
): Promise<boolean> {
  try {
    const db = register.getKnex();
    const indexerName = process.env.INDEX_TESTNET ? 'sep' : 'eth';

    const result = await db('_metadatas')
      .where({ id: 'last_indexed_block', indexer: indexerName })
      .first();

    if (!result?.value) {
      console.log('No indexed blocks yet, skipping expiration check...');
      return false;
    }

    const lastIndexedBlock = parseInt(result.value);
    const latestBlock = await getLatestBlockNumber();
    const blocksBehind = latestBlock - lastIndexedBlock;

    if (blocksBehind <= syncThresholdBlocks) {
      return true;
    }

    console.log(
      `Not in sync (${blocksBehind} blocks behind), skipping expiration check...`
    );
    return false;
  } catch (error: any) {
    console.error('Error checking sync status:', error?.message || error);
    return false;
  }
}
