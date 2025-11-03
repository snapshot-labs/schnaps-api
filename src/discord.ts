import { Payment, Space } from '../.checkpoint/models';
import { ExpiringSpace } from './queries';
import { NOTIFICATION_CONFIG } from './expirationMonitor';

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const INDEX_TESTNET = process.env.INDEX_TESTNET;

const SNAPSHOT_BASE_URL = `https://${INDEX_TESTNET ? 'testnet.' : ''}snapshot.box`;

export async function notifyPayment(
  payment: Payment,
  space: Space,
  block: any,
  tx: any
): Promise<void> {
  if (!DISCORD_WEBHOOK_URL) return;

  const now = ~~(Date.now() / 1e3);
  const recentThreshold = now - 60 * 60; // 1 hour

  if (block.timestamp < recentThreshold) return;

  const explorerBaseUrl = `https://${INDEX_TESTNET ? 'sepolia.' : ''}etherscan.io`;

  await fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [
        {
          title: `💰 New payment of ${payment.amount_decimal} ${payment.token_symbol}`,
          url: `${explorerBaseUrl}/tx/${tx.hash}`,
          author: {
            name: payment.sender,
            icon_url: `https://cdn.stamp.fyi/avatar/${payment.sender}`,
            link: `${explorerBaseUrl}/address/${payment.sender}`
          },
          fields: [
            {
              name: 'Space',
              value: `[${payment.space}](${SNAPSHOT_BASE_URL}/#/${payment.space})`,
              inline: true
            },
            {
              name: 'Network',
              value: !INDEX_TESTNET ? 'Ethereum' : 'Sepolia',
              inline: true
            },
            {
              name: 'Expiration',
              value: `<t:${space.turbo_expiration}:R>`,
              inline: true
            }
          ],
          timestamp: new Date(block.timestamp * 1000).toISOString()
        }
      ]
    })
  });

  return;
}

export async function notifyExpiringSpaces(spaces: ExpiringSpace[]): Promise<void> {
  if (!DISCORD_WEBHOOK_URL || spaces.length === 0) return;

  const spaceLinks = spaces
    .map(space => {
      const config = NOTIFICATION_CONFIG[space.daysLeft];
      const emoji = config.emoji;
      return `${emoji} **[${space.id}](${SNAPSHOT_BASE_URL}/#/s:${space.id}/settings/billing)** — <t:${space.expiration}:R> (<t:${space.expiration}:f>)`;
    })
    .join('\n');

  const content = `💸 **Pro spaces expiring soon**\n\n${spaceLinks}`;

  await fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  });
}
