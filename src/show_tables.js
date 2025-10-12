import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

/**
 * Database Tables Viewer
 * Shows all tables in the database with their structure
 */
class DatabaseViewer {
  constructor() {
    this.pool = new Pool({
      host: process.env.PGHOST,
      port: process.env.PGPORT,
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false
    });
  }

  /**
   * Show all tables in the database
   */
  async showAllTables() {
    try {
      console.log('🗄️ Database Tables Viewer');
      console.log('=' .repeat(50));
      
      // Get all tables
      const tablesQuery = `
        SELECT 
          table_name,
          table_type
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        ORDER BY table_name;
      `;
      
      const tablesResult = await this.pool.query(tablesQuery);
      
      if (tablesResult.rows.length === 0) {
        console.log('❌ No tables found in the database');
        return;
      }
      
      console.log(`📊 Found ${tablesResult.rows.length} tables:`);
      console.log();
      
      // Show each table with its structure
      for (const table of tablesResult.rows) {
        await this.showTableStructure(table.table_name);
        console.log();
      }
      
      // Show table relationships
      await this.showTableRelationships();
      
    } catch (error) {
      console.error('❌ Error showing tables:', error);
      throw error;
    } finally {
      await this.pool.end();
    }
  }

  /**
   * Show structure of a specific table
   */
  async showTableStructure(tableName) {
    try {
      console.log(`📋 Table: ${tableName}`);
      console.log('-'.repeat(30));
      
      // Get column information
      const columnsQuery = `
        SELECT 
          column_name,
          data_type,
          is_nullable,
          column_default,
          character_maximum_length
        FROM information_schema.columns 
        WHERE table_name = $1 AND table_schema = 'public'
        ORDER BY ordinal_position;
      `;
      
      const columnsResult = await this.pool.query(columnsQuery, [tableName]);
      
      if (columnsResult.rows.length === 0) {
        console.log('  ❌ No columns found');
        return;
      }
      
      // Display columns
      columnsResult.rows.forEach(column => {
        const nullable = column.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
        const defaultVal = column.column_default ? ` DEFAULT ${column.column_default}` : '';
        const maxLength = column.character_maximum_length ? `(${column.character_maximum_length})` : '';
        
        console.log(`  📝 ${column.column_name}: ${column.data_type}${maxLength} ${nullable}${defaultVal}`);
      });
      
      // Get row count
      const countResult = await this.pool.query(`SELECT COUNT(*) as count FROM ${tableName}`);
      console.log(`  📊 Rows: ${countResult.rows[0].count}`);
      
      // Get primary key information
      const pkQuery = `
        SELECT column_name
        FROM information_schema.key_column_usage
        WHERE table_name = $1 AND constraint_name LIKE '%_pkey'
        ORDER BY ordinal_position;
      `;
      
      const pkResult = await this.pool.query(pkQuery, [tableName]);
      if (pkResult.rows.length > 0) {
        const pkColumns = pkResult.rows.map(row => row.column_name).join(', ');
        console.log(`  🔑 Primary Key: ${pkColumns}`);
      }
      
      // Get foreign key information
      const fkQuery = `
        SELECT 
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name
        FROM information_schema.key_column_usage AS kcu
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = kcu.constraint_name
        WHERE kcu.table_name = $1 AND kcu.constraint_name LIKE '%_fkey'
        ORDER BY kcu.column_name;
      `;
      
      const fkResult = await this.pool.query(fkQuery, [tableName]);
      if (fkResult.rows.length > 0) {
        console.log('  🔗 Foreign Keys:');
        fkResult.rows.forEach(fk => {
          console.log(`    ${fk.column_name} → ${fk.foreign_table_name}.${fk.foreign_column_name}`);
        });
      }
      
    } catch (error) {
      console.error(`❌ Error showing structure for table ${tableName}:`, error.message);
    }
  }

  /**
   * Show relationships between tables
   */
  async showTableRelationships() {
    try {
      console.log('🔗 Table Relationships');
      console.log('=' .repeat(50));
      
      const relationshipsQuery = `
        SELECT 
          tc.table_name,
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name,
          tc.constraint_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
        ORDER BY tc.table_name, kcu.column_name;
      `;
      
      const relationshipsResult = await this.pool.query(relationshipsQuery);
      
      if (relationshipsResult.rows.length === 0) {
        console.log('❌ No foreign key relationships found');
        return;
      }
      
      relationshipsResult.rows.forEach(rel => {
        console.log(`📎 ${rel.table_name}.${rel.column_name} → ${rel.foreign_table_name}.${rel.foreign_column_name}`);
      });
      
    } catch (error) {
      console.error('❌ Error showing relationships:', error.message);
    }
  }

  /**
   * Show database statistics
   */
  async showDatabaseStats() {
    try {
      console.log('\n📊 Database Statistics');
      console.log('=' .repeat(50));
      
      // Get database size
      const sizeQuery = `
        SELECT pg_size_pretty(pg_database_size(current_database())) as database_size;
      `;
      const sizeResult = await this.pool.query(sizeQuery);
      console.log(`💾 Database Size: ${sizeResult.rows[0].database_size}`);
      
      // Get table sizes
      const tableSizesQuery = `
        SELECT 
          schemaname,
          tablename,
          pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
        FROM pg_tables 
        WHERE schemaname = 'public'
        ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
      `;
      
      const tableSizesResult = await this.pool.query(tableSizesQuery);
      
      if (tableSizesResult.rows.length > 0) {
        console.log('\n📏 Table Sizes:');
        tableSizesResult.rows.forEach(table => {
          console.log(`  ${table.tablename}: ${table.size}`);
        });
      }
      
    } catch (error) {
      console.error('❌ Error showing database stats:', error.message);
    }
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith('show_tables.js')) {
  const viewer = new DatabaseViewer();
  
  viewer.showAllTables()
    .then(() => {
      console.log('\n✅ Database tables viewer completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Database tables viewer failed:', error);
      process.exit(1);
    });
}

export { DatabaseViewer };
