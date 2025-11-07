import { Knex } from 'knex';

export interface Space {
  id: string;
  expiration: number;
}

export interface CategorizedSpaces {
  expired: Space[];
  expiring: Space[];
}

export async function getExpiringSpaces(
  knex: Knex
): Promise<CategorizedSpaces> {
  try {
    const now = ~~(Date.now() / 1e3);
    const sevenDays = 7 * 24 * 60 * 60;

    const spaces = await knex('spaces')
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
  } catch (err) {
    console.error('Error getting expiring spaces:', err);
    return { expired: [], expiring: [] };
  }
}

export async function getLatestIndexedBlock(knex: Knex): Promise<number> {
  try {
    const indexerName = process.env.INDEX_TESTNET ? 'sep' : 'eth';
    const result = await knex('_metadatas')
      .where({
        id: 'last_indexed_block',
        indexer: indexerName
      })
      .first();

    return result?.value ? parseInt(result.value) : 0;
  } catch (err: any) {
    console.error('Error getting latest indexed block:', err);
    return 0;
  }
}
