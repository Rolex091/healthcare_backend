const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,

  ssl: {
    rejectUnauthorized: false,
  },

  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Test connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  }

  console.log('✅ PostgreSQL connected successfully');
  release();
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
});

module.exports = pool;
