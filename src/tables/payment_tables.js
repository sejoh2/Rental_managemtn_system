const db = require('../config/db');

async function initPaymentTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id BIGSERIAL PRIMARY KEY,
      owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      property_id BIGINT REFERENCES properties(id) ON DELETE SET NULL,
      unit_id BIGINT REFERENCES units(id) ON DELETE SET NULL,
      tenant_id BIGINT REFERENCES tenants(id) ON DELETE SET NULL,
      payment_account_id BIGINT REFERENCES payment_accounts(id) ON DELETE SET NULL,
      amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
      payment_method VARCHAR(50) NOT NULL,
      apply_to VARCHAR(50) NOT NULL DEFAULT 'rent_balance',
      payment_source VARCHAR(30) NOT NULL DEFAULT 'manual',
      provider_code VARCHAR(50),
      provider_transaction_id VARCHAR(150),
      business_number VARCHAR(100),
      bill_ref_number VARCHAR(150),
      provider_payload JSONB,
      phone VARCHAR(30),
      reference VARCHAR(150),
      notes TEXT,
      received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status VARCHAR(30) NOT NULL DEFAULT 'unmatched',
      recorded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      matched_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      matched_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.query(`
    ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS payment_account_id BIGINT
    REFERENCES payment_accounts(id) ON DELETE SET NULL;
  `);

  await db.query(`
    ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS provider_code VARCHAR(50);
  `);

  await db.query(`
    ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS provider_transaction_id VARCHAR(150);
  `);

  await db.query(`
    ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS business_number VARCHAR(100);
  `);

  await db.query(`
    ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS bill_ref_number VARCHAR(150);
  `);

  await db.query(`
    ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS provider_payload JSONB;
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_payments_provider_transaction
    ON payments(provider_code, provider_transaction_id);
  `);

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_mpesa_transaction
    ON payments(provider_code, provider_transaction_id)
    WHERE provider_code = 'mpesa'
      AND provider_transaction_id IS NOT NULL;
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_payments_payment_account_id
    ON payments(payment_account_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_payments_tenant_id
    ON payments(tenant_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_payments_status
    ON payments(status);
  `);

  await db.query(`
    DROP TRIGGER IF EXISTS update_payments_updated_at ON payments;
  `);

  await db.query(`
    CREATE TRIGGER update_payments_updated_at
    BEFORE UPDATE ON payments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  console.log('Payment tables initialized successfully');
}

module.exports = initPaymentTables;