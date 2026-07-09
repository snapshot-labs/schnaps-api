import { GetBlockReturnType } from 'viem';
import { CategorizedSpaces } from './queries';
import { Payment, Space } from '../.checkpoint/models';

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const DISCORD_EXPIRATION_WEBHOOK_URL =
  process.env.DISCORD_EXPIRATION_WEBHOOK_URL;
const INDEX_TESTNET = process.env.INDEX_TESTNET;

const SNAPSHOT_BASE_URL = `https://${INDEX_TESTNET ? 'testnet.' : ''}snapshot.box`;

type DiscordMessage = {
  content?: string;
  embeds?: Record<string, unknown>[];
};

async function postToDiscord(body: DiscordMessage): Promise<void> {
  if (!DISCORD_WEBHOOK_URL) return;

  await fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

const isRecent = (timestamp: number) =>
  timestamp >= ~~(Date.now() / 1e3) - 2 * 60 * 60; // within the last 2 hours (> the 1h Stripe window)

export async function notifyPayment(
  payment: Payment,
  space: Space,
  block: GetBlockReturnType,
  txHash: string
): Promise<void> {
  const blockTimestamp = Number(block.timestamp);
  if (!isRecent(blockTimestamp)) return;

  const explorerBaseUrl = `https://${INDEX_TESTNET ? 'sepolia.' : ''}etherscan.io`;

  await postToDiscord({
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
  });
}

export async function notifyStripePayment(
  payment: Payment,
  space: Space,
  livemode: boolean
): Promise<void> {
  if (!isRecent(payment.timestamp)) return;

  // payment.id is `stripe:<invoice_id>`; the dashboard resolves the invoice id
  // directly under /invoices/. Test vs live comes from the invoice's livemode.
  const invoiceId = payment.id.replace(/^stripe:/, '');
  const dashboardUrl = `https://dashboard.stripe.com${livemode ? '' : '/test'}/invoices/${invoiceId}`;

  await postToDiscord({
    embeds: [
      {
        title: `💳 New payment of ${payment.amount_decimal} ${payment.token_symbol}`,
        url: dashboardUrl,
        fields: [
          {
            name: 'Space',
            value: `[${payment.space}](${SNAPSHOT_BASE_URL}/#/${payment.space})`,
            inline: true
          },
          {
            name: 'Source',
            value: 'Stripe',
            inline: true
          },
          {
            name: 'Expiration',
            value: `<t:${space.turbo_expiration}:R>`,
            inline: true
          }
        ],
        timestamp: new Date(payment.timestamp * 1000).toISOString()
      }
    ]
  });
}

export async function notifyStripeRefund(
  space: string,
  timestamp: number,
  amount: string
): Promise<void> {
  if (!isRecent(timestamp)) return;

  await postToDiscord({
    content: `↩️ Stripe payment refunded ($${amount}) for [${space}](${SNAPSHOT_BASE_URL}/#/${space}/settings/billing) — turbo reduced.`
  });
}

export async function notifyStripeCancellation(
  space: string,
  timestamp: number,
  reason?: string | null
): Promise<void> {
  if (!isRecent(timestamp)) return;

  const detail = reason ? ` (${reason})` : '';
  await postToDiscord({
    content: `🚫 Stripe subscription canceled for [${space}](${SNAPSHOT_BASE_URL}/#/${space}/settings/billing)${detail} — turbo runs until it lapses.`
  });
}

export async function sendExpirationNotification(
  categorizedSpaces: CategorizedSpaces
): Promise<void> {
  if (!DISCORD_EXPIRATION_WEBHOOK_URL) return;
  const { expired, expiring } = categorizedSpaces;

  try {
    const sections: string[] = ['💸 **Snapshot Pro expirations**'];

    if (expired.length > 0) {
      sections.push('\n**💀 Expired (within last 30 days)**');
      sections.push(
        ...expired.map(
          space =>
            `[${space.id}](${SNAPSHOT_BASE_URL}/#/${space.id}/settings/billing), <t:${space.expiration}:R> (<t:${space.expiration}:f>)`
        )
      );
    }

    if (expiring.length > 0) {
      sections.push('\n**⏰ Expiring soon (next 7 days)**');
      sections.push(
        ...expiring.map(
          space =>
            `[${space.id}](${SNAPSHOT_BASE_URL}/#/${space.id}/settings/billing), <t:${space.expiration}:R> (<t:${space.expiration}:f>)`
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
