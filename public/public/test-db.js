const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://user:password@host:5432/database',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: true } : false
});
pool.query('SELECT 1 as test', (err, res) => {
  if (err) {
    console.error('DB Connection ERROR:', err.message);
  } else {
    console.log('DB Connection OK - Result:', res.rows[0]);
  }
  pool.end();
});
