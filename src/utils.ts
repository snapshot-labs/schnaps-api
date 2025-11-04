import { createPublicClient, http } from 'viem';
import { config } from '.';

export function getUrl(uri: string, gateway = 'pineapple.fyi') {
  const ipfsGateway = `https://${gateway}`;
  if (!uri) return null;
  if (
    !uri.startsWith('ipfs://') &&
    !uri.startsWith('ipns://') &&
    !uri.startsWith('https://') &&
    !uri.startsWith('http://')
  )
    return `${ipfsGateway}/ipfs/${uri}`;
  const uriScheme = uri.split('://')[0];
  if (uriScheme === 'ipfs') return uri.replace('ipfs://', `${ipfsGateway}/ipfs/`);
  if (uriScheme === 'ipns') return uri.replace('ipns://', `${ipfsGateway}/ipns/`);
  return uri;
}

export async function getJSON(uri: string) {
  const url = getUrl(uri);
  if (!url) throw new Error('Invalid URI');

  return fetch(url).then(res => res.json());
}

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function getLatestBlockNumber(): Promise<number> {
  const client = createPublicClient({
    transport: http(config.network_node_url)
  });

  const blockNumber = await client.getBlockNumber();
  return Number(blockNumber);
}
