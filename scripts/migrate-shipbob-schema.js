#!/usr/bin/env node
/**
 * Migration script to create ShipBob data tables
 * Run with: node scripts/migrate-shipbob-schema.js
 */

const { Client } = require('pg')
require('dotenv').config({ path: '.env.local' })

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  console.error('ERROR: DATABASE_URL not found in .env.local')
  console.error('Add: DATABASE_URL=postgresql://postgres.xhehiuanvcowiktcsmjr:[PASSWORD]@aws-1-us-east-1.pooler.supabase.com:5432/postgres')
  process.exit(1)
}

async function migrate() {
  const client = new Client({ connectionString })

  try {
    await client.connect()
    console.log('Connected to database')

    // 1. Add anonymize_after_months to clients if missing
    console.log('\n1. Checking clients table...')
    const { rows: clientCols } = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'clients' AND column_name = 'anonymize_after_months'
    `)
    if (clientCols.length === 0) {
      await client.query(`ALTER TABLE clients ADD COLUMN anonymize_after_months INTEGER DEFAULT 24`)
      console.log('   Added anonymize_after_months column')
    } else {
      console.log('   anonymize_after_months already exists')
    }

    // 2. Create markup_rules table
    console.log('\n2. Creating markup_rules table...')
    await client.query(`
      CREATE TABLE IF NOT EXISTS markup_rules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        fee_type TEXT,
        ship_option_id TEXT,
        conditions JSONB NOT NULL DEFAULT '{}',
        markup_type TEXT NOT NULL CHECK (markup_type IN ('percentage', 'fixed')),
        markup_value DECIMAL(10,4) NOT NULL,
        priority INTEGER DEFAULT 0,
        is_additive BOOLEAN DEFAULT true,
        effective_from DATE NOT NULL,
        effective_to DATE,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)
    console.log('   markup_rules table created')

    // Create index for markup_rules
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_markup_rules_lookup
      ON markup_rules(client_id, fee_type, is_active)
      WHERE is_active = true
    `)
    console.log('   markup_rules index created')

    // 3. Create invoices table
    console.log('\n3. Creating invoices table...')
    await client.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id UUID REFERENCES clients(id),
        shipbob_invoice_id TEXT UNIQUE,
        invoice_number TEXT NOT NULL,
        period_start TIMESTAMPTZ NOT NULL,
        period_end TIMESTAMPTZ NOT NULL,
        invoice_date DATE NOT NULL,
        invoice_type TEXT NOT NULL,
        base_amount DECIMAL(12,2),
        marked_up_amount DECIMAL(12,2),
        currency_code TEXT DEFAULT 'USD',
        expected_transaction_count INTEGER,
        actual_transaction_count INTEGER,
        reconciliation_status TEXT DEFAULT 'open' CHECK (reconciliation_status IN ('open', 'pending', 'reconciled', 'mismatch')),
        reconciled_at TIMESTAMPTZ,
        payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'overdue')),
        raw_data JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(invoice_number, invoice_type)
      )
    `)
    console.log('   invoices table created')

    // 4. Create shipments table (main transaction table)
    console.log('\n4. Creating shipments table...')
    await client.query(`
      CREATE TABLE IF NOT EXISTS shipments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id UUID REFERENCES clients(id),

        -- ShipBob identifiers
        shipbob_order_id TEXT,
        shipbob_reference_id TEXT,
        tracking_id TEXT,
        store_order_id TEXT,

        -- Order details
        customer_name TEXT,
        order_date DATE,
        label_generation_date TIMESTAMPTZ,
        delivered_date TIMESTAMPTZ,
        transit_time_days DECIMAL(5,2),

        -- Shipping details
        carrier TEXT,
        carrier_service TEXT,
        ship_option_id TEXT,
        zone_used TEXT,
        fc_name TEXT,

        -- Package dimensions
        actual_weight_oz DECIMAL(10,2),
        dim_weight_oz DECIMAL(10,2),
        billable_weight_oz DECIMAL(10,2),
        length DECIMAL(6,2),
        width DECIMAL(6,2),
        height DECIMAL(6,2),

        -- Order classification
        order_category TEXT,

        -- Destination
        zip_code TEXT,
        city TEXT,
        state TEXT,
        country TEXT,

        -- BASE costs (ShipBob's cost to us)
        base_fulfillment_cost DECIMAL(10,2),
        base_surcharge DECIMAL(10,2),
        base_insurance DECIMAL(10,2),
        base_total_cost DECIMAL(10,2),

        -- MARKED UP costs (what client sees/pays)
        marked_up_fulfillment_cost DECIMAL(10,2),
        marked_up_surcharge DECIMAL(10,2),
        marked_up_insurance DECIMAL(10,2),
        marked_up_total_cost DECIMAL(10,2),

        -- Metadata
        transaction_status TEXT,
        invoice_number TEXT,
        invoice_date DATE,
        raw_data JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),

        CONSTRAINT uq_shipments_shipbob_id UNIQUE (shipbob_order_id)
      )
    `)
    console.log('   shipments table created')

    // Create shipments indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_shipments_client ON shipments(client_id)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_shipments_date ON shipments(order_date)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_shipments_tracking ON shipments(tracking_id)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_shipments_invoice ON shipments(invoice_number)`)
    console.log('   shipments indexes created')

    // 5. Create transactions table (billing line items - multiple per shipment)
    console.log('\n5. Creating transactions table...')
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id UUID REFERENCES clients(id),

        -- ShipBob identifiers
        transaction_id TEXT UNIQUE NOT NULL,
        reference_id TEXT,
        reference_type TEXT,

        -- Transaction details
        amount DECIMAL(10,2) NOT NULL,
        currency_code TEXT DEFAULT 'USD',
        charge_date DATE,
        transaction_fee TEXT,
        transaction_type TEXT,
        fulfillment_center TEXT,

        -- Invoice assignment
        invoiced_status BOOLEAN DEFAULT false,
        invoice_id INTEGER,
        invoice_date DATE,

        -- Additional data
        tracking_id TEXT,
        additional_details JSONB,
        raw_data JSONB,

        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)
    console.log('   transactions table created')

    await client.query(`CREATE INDEX IF NOT EXISTS idx_transactions_client ON transactions(client_id)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_transactions_reference ON transactions(reference_id, reference_type)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(charge_date)`)
    console.log('   transactions indexes created')

    // 6. Create credits table
    console.log('\n6. Creating credits table...')
    await client.query(`
      CREATE TABLE IF NOT EXISTS credits (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id UUID REFERENCES clients(id),
        reference_id TEXT NOT NULL,
        shipbob_order_id TEXT,
        care_id UUID,
        credit_reason TEXT NOT NULL,
        credit_type TEXT,
        credit_amount DECIMAL(10,2) NOT NULL,
        currency_code TEXT DEFAULT 'USD',
        original_transaction_type TEXT,
        original_transaction_id TEXT,
        invoice_number TEXT,
        invoice_date DATE,
        notes TEXT,
        raw_data JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT uq_credits_ref UNIQUE (reference_id)
      )
    `)
    console.log('   credits table created')

    await client.query(`CREATE INDEX IF NOT EXISTS idx_credits_client ON credits(client_id)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_credits_care_id ON credits(care_id) WHERE care_id IS NOT NULL`)
    console.log('   credits indexes created')

    // 7. Create fee_type_categories table
    console.log('\n7. Creating fee_type_categories table...')
    await client.query(`
      CREATE TABLE IF NOT EXISTS fee_type_categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        fee_type TEXT UNIQUE NOT NULL,
        category TEXT NOT NULL,
        display_name TEXT,
        description TEXT,
        is_active BOOLEAN DEFAULT true
      )
    `)
    console.log('   fee_type_categories table created')

    // Insert known fee types
    const feeTypes = [
      ['Shipping', 'Shipping', 'Shipping', 'Base carrier shipping cost'],
      ['Per Pick Fee', 'Fulfillment', 'Pick Fee', 'Per-item picking cost'],
      ['Warehousing Fee', 'Storage', 'Storage Fee', 'Monthly storage fees'],
      ['WRO Receiving Fee', 'Inbound', 'Receiving Fee', 'Warehouse receiving labor'],
      ['Return Fee', 'Returns', 'Return Fee', 'Return processing'],
      ['Freight', 'Inbound', 'Freight', 'B2B freight charges'],
      ['Address Correction', 'Surcharge', 'Address Correction', 'Carrier address correction'],
      ['Delivery Area Surcharge', 'Surcharge', 'DAS', 'Remote area delivery fee'],
      ['Long Term Storage Fee', 'Storage', 'Long Term Storage', '6+ month storage fee'],
    ]

    for (const [feeType, category, displayName, description] of feeTypes) {
      await client.query(`
        INSERT INTO fee_type_categories (fee_type, category, display_name, description)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (fee_type) DO NOTHING
      `, [feeType, category, displayName, description])
    }
    console.log('   fee_type_categories seeded')

    // 8. Create webhook_events table (for idempotency)
    console.log('\n8. Creating webhook_events table...')
    await client.query(`
      CREATE TABLE IF NOT EXISTS webhook_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        processed_at TIMESTAMPTZ DEFAULT NOW(),
        raw_payload JSONB
      )
    `)
    console.log('   webhook_events table created')

    console.log('\n✅ Migration complete!')
    console.log('\nTables created:')
    console.log('  - markup_rules (rule-based pricing)')
    console.log('  - invoices (billing reconciliation)')
    console.log('  - shipments (main transaction records)')
    console.log('  - transactions (billing line items)')
    console.log('  - credits (refunds/adjustments)')
    console.log('  - fee_type_categories (fee grouping)')
    console.log('  - webhook_events (idempotency)')

  } catch (error) {
    console.error('Migration failed:', error.message)
    if (error.code === 'ENOTFOUND') {
      console.error('\nCannot connect to database. Check your DATABASE_URL.')
    }
    process.exit(1)
  } finally {
    await client.end()
  }
}

migrate()
