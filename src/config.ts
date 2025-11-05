import { CheckpointConfig } from '@snapshot-labs/checkpoint';
import Schnaps from './abis/Schnaps';

const CONFIG = {
  sep: {
    networkNodeUrl: 'https://rpc.brovider.xyz/11155111',
    contract: '0xe40bfeb5a3014c9b98597088ca71eccdc27ca410',
    start: 7802789
  },
  eth: {
    networkNodeUrl: 'https://rpc.brovider.xyz/1',
    contract: '0xe40bfeb5a3014c9b98597088ca71eccdc27ca410',
    start: 23185322
  }
};

export function createConfig(
  indexerName: keyof typeof CONFIG
): CheckpointConfig {
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
