import { GetBlockReturnType } from 'viem';
import { CategorizedSpaces } from './queries';
import { Payment, Space } from '../.checkpoint/models';

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const DISCORD_EXPIRATION_WEBHOOK_URL =
  process.env.DISCORD_EXPIRATION_WEBHOOK_URL;
const INDEX_TESTNET = process.env.INDEX_TESTNET;

const SNAPSHOT_BASE_URL = `https://${INDEX_TESTNET ? 'testnet.' : ''}snapshot.box`;

export async function notifyPayment(
  payment: Payment,
  space: Space,
  block: GetBlockReturnType,
  txHash: string
): Promise<void> {
  if (!DISCORD_WEBHOOK_URL) return;

  const now = ~~(Date.now() / 1e3);
  const recentThreshold = now - 48 * 60 * 60; // 48 hours

  const blockTimestamp = Number(block.timestamp);

  if (blockTimestamp < recentThreshold) return;

  const explorerBaseUrl = `https://${INDEX_TESTNET ? 'sepolia.' : ''}etherscan.io`;

  await fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [
        {
          title: `💰 New payment of ${payment.amount_decimal} ${payment.token_symbol}`,
          url: `${explorerBaseUrl}/tx/${txHash}`,
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
          timestamp: new Date(blockTimestamp * 1000).toISOString()
        }
      ]
    })
  });

  return;
}

export async function sendExpirationNotification(
  categorizedSpaces: CategorizedSpaces
): Promise<void> {
  if (!DISCORD_EXPIRATION_WEBHOOK_URL) return;
  const { expired, expiring } = categorizedSpaces;

  try {
    const sections: string[] = ['💸 **Snapshot Pro expirations**'];

    if (expired.length > 0) {
      sections.push('\n**💀 Expired (within last 7 days)**');
      sections.push(
        ...expired.map(
          space =>
            `❌ **[${space.id}](${SNAPSHOT_BASE_URL}/#/s:${space.id}/settings/billing)** — <t:${space.expiration}:R> (<t:${space.expiration}:f>)`
        )
      );
    }

    if (expiring.length > 0) {
      sections.push('\n**⏰ Expiring soon (next 7 days)**');
      sections.push(
        ...expiring.map(
          space =>
            `⚠️ **[${space.id}](${SNAPSHOT_BASE_URL}/#/s:${space.id}/settings/billing)** — <t:${space.expiration}:R> (<t:${space.expiration}:f>)`
        )
      );
    }

    const response = await fetch(DISCORD_EXPIRATION_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: sections.join('\n') })
    });
    if (!response.ok)
      throw new Error(
        `Discord webhook responded with status ${response.status}`
      );
    console.log(
      `Sent notification for ${expired.length + expiring.length} spaces (${
        expired.length
      } expired, ${expiring.length} expiring)`
    );
  } catch (err) {
    console.error('Failed to send expiration notification:', err);
  }
}
