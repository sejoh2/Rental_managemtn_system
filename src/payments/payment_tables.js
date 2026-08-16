const db = require("../config/db");

async function init_payment_tables() {
  /*
   |--------------------------------------------------------------------------
   | Payments
   |--------------------------------------------------------------------------
   */
  await db.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id BIGSERIAL PRIMARY KEY,

      owner_id BIGINT NOT NULL
        REFERENCES users(user_id)
        ON DELETE CASCADE,

      property_id BIGINT
        REFERENCES properties(id)
        ON DELETE SET NULL,

      unit_id BIGINT
        REFERENCES units(id)
        ON DELETE SET NULL,

      tenant_id BIGINT
        REFERENCES tenants(id)
        ON DELETE SET NULL,

      payment_account_id BIGINT
        REFERENCES payment_accounts(id)
        ON DELETE SET NULL,

      amount NUMERIC(12,2)
        NOT NULL
        CHECK (amount > 0),

      payment_method VARCHAR(50)
        NOT NULL,

      apply_to VARCHAR(50)
        NOT NULL
        DEFAULT 'rent_balance'
        CHECK (
          apply_to IN (
            'rent_balance',
            'water_bill',
            'deposit',
            'other'
          )
        ),

      payment_source VARCHAR(30)
        NOT NULL
        DEFAULT 'manual'
        CHECK (
          payment_source IN (
            'manual',
            'provider',
            'system'
          )
        ),

      provider_code VARCHAR(50),

      provider_transaction_id VARCHAR(150),

      business_number VARCHAR(100),

      bill_ref_number VARCHAR(150),

      provider_payload JSONB,

      phone VARCHAR(30),

      reference VARCHAR(150),

      notes TEXT,

      received_at TIMESTAMPTZ
        NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

      status VARCHAR(30)
        NOT NULL
        DEFAULT 'unmatched'
        CHECK (
          status IN (
            'unmatched',
            'matched',
            'reversed',
            'failed'
          )
        ),

      recorded_by BIGINT
        REFERENCES users(user_id)
        ON DELETE SET NULL,

      matched_by BIGINT
        REFERENCES users(user_id)
        ON DELETE SET NULL,

      matched_at TIMESTAMPTZ,

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
    CREATE INDEX IF NOT EXISTS idx_payments_owner_id
    ON payments(owner_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_payments_property_id
    ON payments(property_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_payments_unit_id
    ON payments(unit_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_payments_tenant_id
    ON payments(tenant_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_payments_payment_account_id
    ON payments(payment_account_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_payments_status
    ON payments(status);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_payments_provider_transaction
    ON payments(provider_code, provider_transaction_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_payments_business_number
    ON payments(business_number);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_payments_bill_ref_number
    ON payments(bill_ref_number);
  `);

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_mpesa_transaction
    ON payments(provider_code, provider_transaction_id)
    WHERE provider_code = 'mpesa'
      AND provider_transaction_id IS NOT NULL;
  `);

  /*
   |--------------------------------------------------------------------------
   | Triggers
   |--------------------------------------------------------------------------
   */

  await db.query(`
    CREATE OR REPLACE TRIGGER update_payments_updated_at
    BEFORE UPDATE ON payments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  console.log("Payments table initialized successfully.");
}

module.exports = {
  init_payment_tables,
};