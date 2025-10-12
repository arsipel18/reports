import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// PostgreSQL connection configuration for AWS Lightsail
const dbConfig = {
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

let pool = null;

/**
 * Create and return a database connection pool
 */
export const createDbConnection = async () => {
  if (!pool) {
    pool = new Pool(dbConfig);
    
    // Test the connection
    try {
      const client = await pool.connect();
      console.log('✅ PostgreSQL connection established successfully');
      client.release();
    } catch (error) {
      console.error('❌ PostgreSQL connection failed:', error);
      throw error;
    }
  }
  
  return pool;
};

/**
 * Get a database client from the pool
 */
export const getDbClient = async () => {
  if (!pool) {
    pool = await createDbConnection();
  }
  return pool.connect();
};

/**
 * Execute a query with parameters
 */
export const query = async (text, params) => {
  if (!pool) {
    pool = await createDbConnection();
  }
  
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('🔍 Query executed:', { text: text.substring(0, 100), duration, rows: result.rowCount });
    return result;
  } catch (error) {
    console.error('❌ Query error:', { text: text.substring(0, 100), error: error.message });
    throw error;
  }
};

/**
 * Close the database connection pool
 */
export const closeDb = async () => {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('📴 Database connection pool closed');
  }
};

/**
 * Health check for database connection
 */
export const healthCheck = async () => {
  try {
    const result = await query('SELECT NOW() as current_time, version() as version');
    return {
      status: 'healthy',
      timestamp: result.rows[0].current_time,
      version: result.rows[0].version
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message
    };
  }
};

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Received SIGINT, closing database connections...');
  await closeDb();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🛑 Received SIGTERM, closing database connections...');
  await closeDb();
  process.exit(0);
});
