const db = require('../config/db');

const DEFAULT_WATER_RATE = Number(process.env.DEFAULT_WATER_RATE_PER_UNIT) || 100;
const DEFAULT_RENT_DUE_DAY =
  process.env.DEFAULT_RENT_DUE_DAY || '5th of every month';
const DEFAULT_WATER_READING_DUE_DAYS =
  Number(process.env.DEFAULT_WATER_READING_DUE_DAYS) || 3;

async function initPropertyTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS properties (
      id BIGSERIAL PRIMARY KEY,
      owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      caretaker_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      name VARCHAR(255) NOT NULL,
      location VARCHAR(255) NOT NULL,
      property_type VARCHAR(50) NOT NULL DEFAULT 'apartment_block',
      expected_units INTEGER NOT NULL DEFAULT 0 CHECK (expected_units >= 0),
      rent_due_day VARCHAR(100) NOT NULL DEFAULT '${DEFAULT_RENT_DUE_DAY}',
      water_billing_method VARCHAR(50) NOT NULL DEFAULT 'per_unit_metered',
      water_rate_per_unit NUMERIC(12, 2) NOT NULL DEFAULT ${DEFAULT_WATER_RATE},
      water_fixed_fee NUMERIC(12, 2) NOT NULL DEFAULT 0,
      water_billing_day VARCHAR(50) DEFAULT 'same_as_rent',
      water_reading_due_days INTEGER NOT NULL DEFAULT ${DEFAULT_WATER_READING_DUE_DAYS},
      water_missed_reading_action VARCHAR(50) NOT NULL DEFAULT 'carry_forward',
      sms_sender_id VARCHAR(50),
      status VARCHAR(30) NOT NULL DEFAULT 'active',
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(owner_id, name)
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS payment_accounts (
      id BIGSERIAL PRIMARY KEY,
      owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      account_for VARCHAR(30) NOT NULL,
      account_type VARCHAR(50) NOT NULL DEFAULT 'other',
      provider_code VARCHAR(50),
      provider_name VARCHAR(100),
      business_number VARCHAR(100),
      till_number VARCHAR(100),
      account_number VARCHAR(100),
      account_name VARCHAR(150),
      label VARCHAR(150),
      connection_status VARCHAR(30) NOT NULL DEFAULT 'not_connected',
      connection_error TEXT,
      connected_at TIMESTAMPTZ,
      callback_registered_at TIMESTAMPTZ,
      last_connection_test_at TIMESTAMPTZ,
      status VARCHAR(30) NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS payment_provider_credentials (
      id BIGSERIAL PRIMARY KEY,
      payment_account_id BIGINT NOT NULL UNIQUE
        REFERENCES payment_accounts(id) ON DELETE CASCADE,
      provider_code VARCHAR(50) NOT NULL,
      environment VARCHAR(30) NOT NULL DEFAULT 'sandbox',
      encrypted_credentials TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.query(`
    ALTER TABLE properties
    ADD COLUMN IF NOT EXISTS water_fixed_fee NUMERIC(12, 2) NOT NULL DEFAULT 0;
  `);

  await db.query(`
    ALTER TABLE properties
    ADD COLUMN IF NOT EXISTS water_billing_day VARCHAR(50) DEFAULT 'same_as_rent';
  `);

  await db.query(`
    ALTER TABLE properties
    ADD COLUMN IF NOT EXISTS water_reading_due_days INTEGER NOT NULL DEFAULT ${DEFAULT_WATER_READING_DUE_DAYS};
  `);

  await db.query(`
    ALTER TABLE properties
    ADD COLUMN IF NOT EXISTS water_missed_reading_action VARCHAR(50) NOT NULL DEFAULT 'carry_forward';
  `);

  await db.query(`
    ALTER TABLE payment_accounts
    ADD COLUMN IF NOT EXISTS provider_code VARCHAR(50);
  `);

  await db.query(`
    ALTER TABLE payment_accounts
    ADD COLUMN IF NOT EXISTS connection_status VARCHAR(30) NOT NULL DEFAULT 'not_connected';
  `);

  await db.query(`
    ALTER TABLE payment_accounts
    ADD COLUMN IF NOT EXISTS connection_error TEXT;
  `);

  await db.query(`
    ALTER TABLE payment_accounts
    ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ;
  `);

  await db.query(`
    ALTER TABLE payment_accounts
    ADD COLUMN IF NOT EXISTS callback_registered_at TIMESTAMPTZ;
  `);

  await db.query(`
    ALTER TABLE payment_accounts
    ADD COLUMN IF NOT EXISTS last_connection_test_at TIMESTAMPTZ;
  `);

  await db.query(`
    ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_property_type_check;
  `);

  await db.query(`
    ALTER TABLE properties
    ADD CONSTRAINT properties_property_type_check
    CHECK (property_type IN ('apartment_block', 'bedsitters', 'mixed_use', 'single_rooms'));
  `);

  await db.query(`
    ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_water_billing_method_check;
  `);

  await db.query(`
    ALTER TABLE properties
    ADD CONSTRAINT properties_water_billing_method_check
    CHECK (water_billing_method IN ('per_unit_metered', 'fixed_monthly', 'included_in_rent'));
  `);

  await db.query(`
    ALTER TABLE payment_accounts DROP CONSTRAINT IF EXISTS payment_accounts_account_for_check;
  `);

  await db.query(`
    ALTER TABLE payment_accounts
    ADD CONSTRAINT payment_accounts_account_for_check
    CHECK (account_for IN ('rent', 'water'));
  `);

  await db.query(`
    ALTER TABLE payment_accounts DROP CONSTRAINT IF EXISTS payment_accounts_account_type_check;
  `);

  await db.query(`
    ALTER TABLE payment_accounts
    ADD CONSTRAINT payment_accounts_account_type_check
    CHECK (
      account_type IN (
        'mpesa_paybill',
        'mpesa_till',
        'bank_equity',
        'bank_kcb',
        'bank_coop',
        'bank_ncba',
        'bank_absa',
        'bank_account',
        'cash',
        'other'
      )
    );
  `);

  await db.query(`
    ALTER TABLE payment_accounts DROP CONSTRAINT IF EXISTS payment_accounts_connection_status_check;
  `);

  await db.query(`
    ALTER TABLE payment_accounts
    ADD CONSTRAINT payment_accounts_connection_status_check
    CHECK (connection_status IN ('not_connected', 'connecting', 'connected', 'failed'));
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_payment_accounts_property_id
    ON payment_accounts(property_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_payment_accounts_shortcode
    ON payment_accounts(business_number);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_payment_accounts_till_number
    ON payment_accounts(till_number);
  `);

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_active_payment_account_per_property_type
    ON payment_accounts(property_id, account_for)
    WHERE status = 'active';
  `);

  await db.query(`
    DROP TRIGGER IF EXISTS update_properties_updated_at ON properties;
  `);

  await db.query(`
    CREATE TRIGGER update_properties_updated_at
    BEFORE UPDATE ON properties
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  await db.query(`
    DROP TRIGGER IF EXISTS update_payment_accounts_updated_at ON payment_accounts;
  `);

  await db.query(`
    CREATE TRIGGER update_payment_accounts_updated_at
    BEFORE UPDATE ON payment_accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  await db.query(`
    DROP TRIGGER IF EXISTS update_payment_provider_credentials_updated_at
    ON payment_provider_credentials;
  `);

  await db.query(`
    CREATE TRIGGER update_payment_provider_credentials_updated_at
    BEFORE UPDATE ON payment_provider_credentials
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  console.log('Property payment account tables initialized successfully');
}

module.exports = initPropertyTables;