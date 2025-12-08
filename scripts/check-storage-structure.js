const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function listStorage() {
  // Check first client folder
  const clientId1 = '6b94c274-0446-4167-9d02-b998f8be59ad';
  const { data: files1 } = await supabase.storage
    .from('invoices')
    .list(clientId1, { limit: 20 });

  console.log('Client 1 folder contents:');
  for (const f of files1 || []) {
    console.log('  ', f.name, f.id ? '(file)' : '(folder)');
    // If folder, check contents
    if (!f.id) {
      const { data: subfiles } = await supabase.storage
        .from('invoices')
        .list(clientId1 + '/' + f.name, { limit: 10 });
      if (subfiles && subfiles.length > 0) {
        console.log('    └─', subfiles.map(s => s.name).join(', '));
      }
    }
  }

  // Check second client folder  
  const clientId2 = 'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e';
  const { data: files2 } = await supabase.storage
    .from('invoices')
    .list(clientId2, { limit: 20 });

  console.log('\nClient 2 folder contents:');
  for (const f of files2 || []) {
    console.log('  ', f.name, f.id ? '(file)' : '(folder)');
    if (!f.id) {
      const { data: subfiles } = await supabase.storage
        .from('invoices')
        .list(clientId2 + '/' + f.name, { limit: 10 });
      if (subfiles && subfiles.length > 0) {
        console.log('    └─', subfiles.map(s => s.name).join(', '));
      }
    }
  }
}

listStorage();
