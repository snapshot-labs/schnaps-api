import pg from 'pg-promise';

const DATABASE_URL: string = process.env.DATABASE_URL || '';

const pgp = pg();
const db = pgp(DATABASE_URL);

export default db;
