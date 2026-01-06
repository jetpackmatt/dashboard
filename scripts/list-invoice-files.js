const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function listFiles() {
  // Methyl-Life client ID
  const clientId = 'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e';
  const invoiceNumber = 'JPML-0023-121525';

  const { data: files, error } = await supabase.storage
    .from('invoices')
    .list(`${clientId}/${invoiceNumber}`);

  console.log(`Files in ${invoiceNumber} folder:`);
  if (error) {
    console.log('  Error:', error.message);
  } else {
    (files || []).forEach(f => console.log('  ' + f.name));
  }
}

listFiles();
