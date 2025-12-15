import { backOff } from "exponential-backoff";

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
  if (uriScheme === 'ipfs')
    return uri.replace('ipfs://', `${ipfsGateway}/ipfs/`);
  if (uriScheme === 'ipns')
    return uri.replace('ipns://', `${ipfsGateway}/ipns/`);
  return uri;
}

export async function getJSON(uri: string) {
  const url = getUrl(uri);
  if (!url) {
    throw new Error(`Invalid URI: ${uri}`);
  }

  return await backOff(
    async () => {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15000)
      });

      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }

      return res.json();
    },
    {
      numOfAttempts: 3
    }
  );
}

export const sleep = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms));
