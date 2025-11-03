import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import Checkpoint, { evm, LogLevel } from '@snapshot-labs/checkpoint';
import { createConfig } from './config';
import { createEvmWriters } from './writers';
import overrides from './overrides.json';
import { startExpirationMonitor } from './expirationMonitor';
import { sleep } from './utils';

const PRODUCTION_INDEXER_DELAY = 60 * 1000;
const dir = __dirname.endsWith('dist/src') ? '../' : '';
const schemaFile = path.join(__dirname, `${dir}../src/schema.gql`);
const schema = fs.readFileSync(schemaFile, 'utf8');

if (process.env.CA_CERT) {
  process.env.CA_CERT = process.env.CA_CERT.replace(/\\n/g, '\n');
}

const checkpoint = new Checkpoint(schema, {
  logLevel: LogLevel.Info,
  prettifyLogs: true,
  overridesConfig: overrides
});

if (process.env.INDEX_TESTNET) {
  // Only index testnets
  const sepConfig = createConfig('sep');
  const sepIndexer = new evm.EvmIndexer(createEvmWriters('sep'));
  checkpoint.addIndexer('sep', sepConfig, sepIndexer);
} else {
  const ethConfig = createConfig('eth');
  const ethIndexer = new evm.EvmIndexer(createEvmWriters('eth'));
  checkpoint.addIndexer('eth', ethConfig, ethIndexer);
}

async function run() {
  if (process.env.NODE_ENV === 'production') {
    console.log('Delaying indexer to prevent multiple processes indexing at the same time.');
    await sleep(PRODUCTION_INDEXER_DELAY);
  }

  await checkpoint.resetMetadata();
  await checkpoint.reset();
  checkpoint.start();
  startExpirationMonitor();
}

run();

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ limit: '4mb', extended: false }));
app.use(cors({ maxAge: 86400 }));
app.use('/', checkpoint.graphql);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening at http://localhost:${PORT}`));
