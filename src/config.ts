import { CheckpointConfig } from '@snapshot-labs/checkpoint';
import Schnaps from './abis/Schnaps.json';

/** Infura API key used by default for network nodes. */
export const DEFAULT_INFURA_API_KEY =
  process.env.INFURA_API_KEY || '46a5dd9727bf48d4a132672d3f376146';

const CONFIG = {
  sepolia: {
    networkNodeUrl: `https://sepolia.infura.io/v3/${DEFAULT_INFURA_API_KEY}`,
    contract: '0xe40bfeb5a3014c9b98597088ca71eccdc27ca410',
    start: 7802789
  },
  base: {
    networkNodeUrl: `https://base-mainnet.infura.io/v3/${DEFAULT_INFURA_API_KEY}`,
    contract: '0xe40bfeb5a3014c9b98597088ca71eccdc27ca410',
    start: 26970837
  }
};

export function createConfig(indexerName: keyof typeof CONFIG): CheckpointConfig {
  const { networkNodeUrl, contract, start } = CONFIG[indexerName];

  return {
    network_node_url: networkNodeUrl,
    optimistic_indexing: false,
    fetch_interval: 15000,
    sources: [
      {
        contract,
        start,
        abi: 'Schnaps',
        events: [
          {
            name: 'PaymentReceived(address,address,uint256,string)',
            fn: 'handlePaymentReceived'
          }
        ]
      }
    ],
    abis: {
      Schnaps
    }
  };
}
