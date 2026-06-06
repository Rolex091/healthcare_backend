const { Pool } = require('pg');
require('dotenv').config();
console.log("DATABASE_URL =", process.env.DATABASE_URL);

const isLocal = process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  ssl: isLocal ? false : {
    rejectUnauthorized: false, // ✅ Supabase ku mandatory
  },

  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// ✅ Test DB connection (SAFE)
(async () => {
  try {
    const client = await pool.connect();
    console.log('✅ PostgreSQL connected successfully');
    client.release();
  } catch (err) {
    console.error('❌ Database connection failed');
    console.error('Message:', err?.message);
    console.error('Code:', err?.code);
    console.error('Full Error:', err);
  }
})();

module.exports = pool;