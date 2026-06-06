const fs = require('fs');
const path = require('path');
const pool = require('./src/config/db');

async function run() {
  try {
    const sqlPath = path.join(__dirname, 'src', 'database', 'migrations.sql');
    console.log('Reading migration file from:', sqlPath);
    let sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Remove psql meta-commands (like \echo or \copy)
    sql = sql.replace(/^\\.*/gm, '');
    
    // Split statements by semicolon (simple splitter, works for this schema)
    // We split by custom comment blocks or semicolons
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);
      
    console.log(`Split migration into ${statements.length} statements. Executing...`);
    
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      try {
        await pool.query(stmt);
      } catch (err) {
        // Ignore errors about storage.buckets or publications on local DB
        if (
          err.message.includes('storage.buckets') || 
          err.message.includes('publication') || 
          err.message.includes('relation "storage.buckets" does not exist') ||
          err.message.includes('publication "supabase_realtime" does not exist')
        ) {
          console.log(`⚠️ Ignored expected local DB compatibility warning on statement ${i + 1}: ${err.message}`);
        } else {
          console.error(`❌ Statement ${i + 1} failed:`, err.message);
          console.error('Statement content:', stmt);
          throw err;
        }
      }
    }
    
    console.log('✅ Migrations applied successfully!');
    
    // Test if tables exist
    const testResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('doctor_patient_chats', 'chat_participants', 'chat_messages_files', 'medical_reports', 'medical_metrics', 'ai_report_analysis', 'report_history', 'chat_read_status', 'appointment_reminders')
    `);
    console.log('Tables created/verified:', testResult.rows.map(r => r.table_name));
    
  } catch (err) {
    console.error('❌ Migration process crashed:', err);
  } finally {
    await pool.end();
  }
}

run();
