const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  ssl: {
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
    console.error('❌ Database connection failed:', err.message);
    // ❗ remove process.exit → server crash avoid
  }
})();

// ✅ Handle unexpected errors
pool.on('error', (err) => {
  console.error('🔥 Unexpected DB error:', err.message);
});

module.exports = pool;