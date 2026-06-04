const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('⚠️ Supabase credentials (SUPABASE_URL and SUPABASE_KEY) are missing in environment variables.');
}

const supabase = createClient(supabaseUrl || '', supabaseKey || '');

module.exports = supabase;
