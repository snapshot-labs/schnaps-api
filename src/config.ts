import { CheckpointConfig } from '@snapshot-labs/checkpoint';
import Schnaps from './abis/Schnaps.json';

const CONFIG = {
  base: {
    networkNodeUrl: 'https://base-rpc.publicnode.com',
    contract: '0xa92d665c4814c8e1681aab292ba6d2278d01dee0',
    start: 25947620
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
            name: 'PaymentReceived',
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
