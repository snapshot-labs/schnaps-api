import { Payment, Space } from '../.checkpoint/models';

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const INDEX_TESTNET = process.env.INDEX_TESTNET;

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
  const snapshotBaseUrl = `https://${INDEX_TESTNET ? 'testnet.' : ''}snapshot.box`;

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
              value: `[${payment.space}](${snapshotBaseUrl}/#/${payment.space})`,
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
