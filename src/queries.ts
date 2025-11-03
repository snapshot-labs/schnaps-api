import db from './db';
import { getLatestBlockNumber } from './utils';

export interface ExpiringSpace {
  id: string;
  daysLeft: number;
  expiration: number;
  key: string;
}

export async function getExpiringSpacesForNotification(
  notificationDays: number[]
): Promise<ExpiringSpace[]> {
  try {
    const now = ~~(Date.now() / 1e3);
    const oneDaySeconds = 24 * 60 * 60;

    const windows = notificationDays.map(days => ({
      days,
      start: now + (days - 1) * oneDaySeconds,
      end: now + days * oneDaySeconds
    }));

    const conditions = windows
      .map((_, i) => `(turbo_expiration BETWEEN $${i * 3 + 1} AND $${i * 3 + 2})`)
      .join(' OR ');
    const caseStatements = windows
      .map(
        (_, i) => `WHEN turbo_expiration BETWEEN $${i * 3 + 1} AND $${i * 3 + 2} THEN $${i * 3 + 3}`
      )
      .join('\n               ');

    const query = `
      SELECT DISTINCT ON (id) id, turbo_expiration,
             CASE 
               ${caseStatements}
             END as days_left
      FROM spaces 
      WHERE ${conditions}
      ORDER BY id, (block_range::int8range).upper DESC
    `;

    const params = windows.flatMap(w => [w.start, w.end, w.days]);

    const spaces = await db.query(query, params);

    return spaces
      .map(space => {
        const daysLeft = parseFloat(space.days_left);
        const expiration = space.turbo_expiration;
        return {
          id: space.id,
          daysLeft,
          expiration,
          key: `${space.id}-${daysLeft}-${expiration}`
        };
      })
      .sort((a, b) => b.expiration - a.expiration);
  } catch (error) {
    console.error('Error getting expiring spaces for notification:', error);
    return [];
  }
}

export async function checkIfInSync(syncThresholdBlocks: number): Promise<boolean> {
  try {
    const indexerName = process.env.INDEX_TESTNET ? 'sep' : 'eth';

    const result = await db.oneOrNone(
      `SELECT value FROM _metadatas WHERE id = 'last_indexed_block' AND indexer = $1`,
      [indexerName]
    );

    if (!result?.value) {
      console.log('No indexed blocks yet, skipping expiration check...');
      return false;
    }

    const lastIndexedBlock = parseInt(result.value);
    const latestBlock = await getLatestBlockNumber();
    const blocksBehind = latestBlock - lastIndexedBlock;

    console.log(
      `Last indexed block: ${lastIndexedBlock}, Latest block: ${latestBlock}, Behind: ${blocksBehind}`
    );

    if (lastIndexedBlock > 0 && blocksBehind <= syncThresholdBlocks) {
      return true;
    }

    console.log(`Not in sync (${blocksBehind} blocks behind), skipping expiration check...`);
    return false;
  } catch (error: any) {
    if (error?.code === '42P01') {
      console.log('Checkpoint not initialized yet, skipping expiration check...');
      return false;
    }
    console.log('Error checking sync status:', error?.message || error);
    return false;
  }
}
