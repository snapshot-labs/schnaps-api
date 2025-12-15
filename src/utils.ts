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

export async function getJSON(uri: string, retries = 3) {
  const url = getUrl(uri);
  if (!url) {
    console.error(`Invalid URI: ${uri}`);
    return null;
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      return await res.json();
    } catch (error) {
      lastError = error as Error;

      if (lastError.message.includes('is not valid JSON')) {
        console.error(`Invalid JSON from ${uri}:`, lastError);
        return null;
      }

      if (attempt < retries) await sleep(2000);
    }
  }

  console.error(`Failed to fetch or parse JSON from ${uri}:`, lastError);
  return null;
}

export const sleep = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms));
