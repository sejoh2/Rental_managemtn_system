const db = require("../config/db");

const DEFAULT_WATER_RATE =
  Number(process.env.DEFAULT_WATER_RATE_PER_UNIT) || 100;

const DEFAULT_RENT_DUE_DAY =
  process.env.DEFAULT_RENT_DUE_DAY || "5th of every month";

const DEFAULT_WATER_READING_DUE_DAYS =
  Number(process.env.DEFAULT_WATER_READING_DUE_DAYS) || 3;

async function init_property_tables() {
  /*
   |--------------------------------------------------------------------------
   | Properties
   |--------------------------------------------------------------------------
   */
  await db.query(`
    CREATE TABLE IF NOT EXISTS properties (
      id BIGSERIAL PRIMARY KEY,

      owner_id BIGINT NOT NULL
        REFERENCES users(user_id)
        ON DELETE CASCADE,

      caretaker_id BIGINT
        REFERENCES users(user_id)
        ON DELETE SET NULL,

      created_by BIGINT
        REFERENCES users(user_id)
        ON DELETE SET NULL,

      name VARCHAR(255) NOT NULL,

      location VARCHAR(255) NOT NULL,

      property_type VARCHAR(50)
        NOT NULL
        DEFAULT 'apartment_block'
        CHECK (
          property_type IN (
            'apartment_block',
            'bedsitters',
            'mixed_use',
            'single_rooms'
          )
        ),

      expected_units INTEGER
        NOT NULL
        DEFAULT 0
        CHECK (expected_units >= 0),

      rent_due_day VARCHAR(100)
        NOT NULL
        DEFAULT '${DEFAULT_RENT_DUE_DAY}',

      water_billing_method VARCHAR(50)
        NOT NULL
        DEFAULT 'per_unit_metered'
        CHECK (
          water_billing_method IN (
            'per_unit_metered',
            'fixed_monthly',
            'included_in_rent'
          )
        ),

      water_rate_per_unit NUMERIC(12,2)
        NOT NULL
        DEFAULT ${DEFAULT_WATER_RATE},

      water_fixed_fee NUMERIC(12,2)
        NOT NULL
        DEFAULT 0,

      water_billing_day VARCHAR(50)
        DEFAULT 'same_as_rent',

      water_reading_due_days INTEGER
        NOT NULL
        DEFAULT ${DEFAULT_WATER_READING_DUE_DAYS},

      water_missed_reading_action VARCHAR(50)
        NOT NULL
        DEFAULT 'carry_forward',

      sms_sender_id VARCHAR(50),

      status VARCHAR(30)
        NOT NULL
        DEFAULT 'active'
        CHECK (
          status IN (
            'active',
            'inactive',
            'archived'
          )
        ),

      archived_at TIMESTAMPTZ,

      created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

      updated_at TIMESTAMPTZ
        NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

      UNIQUE(owner_id, name)
    );
  `);
        /*
        |--------------------------------------------------------------------------
        | Payment Accounts
        |--------------------------------------------------------------------------
        |
        | provider_code examples:
        | 
        |  Supported providers are defined in  PAYMENT_PROVIDERS.
        */
  await db.query(`
    CREATE TABLE IF NOT EXISTS payment_accounts (
      id BIGSERIAL PRIMARY KEY,

      owner_id BIGINT NOT NULL
        REFERENCES users(user_id)
        ON DELETE CASCADE,

      property_id BIGINT NOT NULL
        REFERENCES properties(id)
        ON DELETE CASCADE,

      account_for VARCHAR(30)
        NOT NULL
        CHECK (
          account_for IN (
            'rent',
            'water'
          )
        ),

      provider_code VARCHAR(50)
        NOT NULL,

      account_type VARCHAR(50)
        NOT NULL
        CHECK (
            account_type IN (
            'paybill',
            'till',
            'bank_account',
            'wallet',
            'cash',
            'other'
            )
        ),

      display_name VARCHAR(100),

      account_name VARCHAR(150),

      label VARCHAR(150),

      business_number VARCHAR(100),

      till_number VARCHAR(100),

      account_number VARCHAR(100),

      connection_status VARCHAR(30)
        NOT NULL
        DEFAULT 'not_connected'
        CHECK (
          connection_status IN (
            'not_connected',
            'connecting',
            'connected',
            'failed'
          )
        ),

      connection_error TEXT,

      connected_at TIMESTAMPTZ,

      callback_registered_at TIMESTAMPTZ,

      last_connection_test_at TIMESTAMPTZ,

      status VARCHAR(30)
        NOT NULL
        DEFAULT 'active'
        CHECK (
          status IN (
            'active',
            'inactive'
          )
        ),

      created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

      updated_at TIMESTAMPTZ
        NOT NULL
        DEFAULT CURRENT_TIMESTAMP
    );
  `);
    /*
   |--------------------------------------------------------------------------
   | Payment Provider Credentials
   |--------------------------------------------------------------------------
   */
  await db.query(`
    CREATE TABLE IF NOT EXISTS provider_credentials (
      id BIGSERIAL PRIMARY KEY,

      payment_account_id BIGINT
        NOT NULL
        UNIQUE
        REFERENCES payment_accounts(id)
        ON DELETE CASCADE,

      provider_code VARCHAR(50)
        NOT NULL,

      environment VARCHAR(30)
        NOT NULL
        DEFAULT 'sandbox'
        CHECK (
          environment IN (
            'sandbox',
            'production'
          )
        ),

      encrypted_credentials TEXT
        NOT NULL,

      connection_status VARCHAR(30)
        NOT NULL
        DEFAULT 'not_connected'
        CHECK (
          connection_status IN (
            'not_connected',
            'connecting',
            'connected',
            'failed'
          )
        ),

      last_connected_at TIMESTAMPTZ,

      created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

      updated_at TIMESTAMPTZ
        NOT NULL
        DEFAULT CURRENT_TIMESTAMP
    );
  `);
    /*
   |--------------------------------------------------------------------------
   | Indexes
   |--------------------------------------------------------------------------
   */

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_properties_owner_id
    ON properties(owner_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_properties_caretaker_id
    ON properties(caretaker_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_payment_accounts_property_id
    ON payment_accounts(property_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_payment_accounts_owner_id
    ON payment_accounts(owner_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_payment_accounts_provider_code
    ON payment_accounts(provider_code);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_payment_accounts_business_number
    ON payment_accounts(business_number);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_payment_accounts_till_number
    ON payment_accounts(till_number);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_provider_credentials_provider_code
    ON provider_credentials(provider_code);
  `);

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_active_payment_account
    ON payment_accounts(property_id, account_for)
    WHERE status = 'active';
  `);

  /*
   |--------------------------------------------------------------------------
   | Triggers
   |--------------------------------------------------------------------------
   */

  await db.query(`
    CREATE OR REPLACE TRIGGER update_properties_updated_at
    BEFORE UPDATE ON properties
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  await db.query(`
    CREATE OR REPLACE TRIGGER update_payment_accounts_updated_at
    BEFORE UPDATE ON payment_accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  await db.query(`
    CREATE OR REPLACE TRIGGER update_provider_credentials_updated_at
    BEFORE UPDATE ON provider_credentials
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  console.log(
  "Properties, payment accounts and provider credentials tables initialized successfully."
);
}

module.exports = {
  init_property_tables,
};