const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://postgres:HnhFXZlhVsRThnoPULNrmiaeFHywRFDT@thomas.proxy.rlwy.net:59117/railway',
  ssl: { rejectUnauthorized: false }
});
pool.query('SELECT 1 as test', (err, res) => {
  if (err) {
    console.error('DB Connection ERROR:', err.message);
  } else {
    console.log('DB Connection OK - Result:', res.rows[0]);
  }
  pool.end();
});
