const db = require('../config/db');

async function initTenantTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id BIGSERIAL PRIMARY KEY,
      owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      unit_id BIGINT NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
      full_name VARCHAR(200) NOT NULL,
      phone VARCHAR(30) NOT NULL,
      id_number VARCHAR(100),
      move_in_date DATE,
      monthly_rent NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (monthly_rent >= 0),
      rent_paid NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (rent_paid >= 0),

      rent_deposit_amount NUMERIC(12, 2) NOT NULL DEFAULT 0
        CHECK (rent_deposit_amount >= 0),
      rent_deposit_paid NUMERIC(12, 2) NOT NULL DEFAULT 0
        CHECK (rent_deposit_paid >= 0),

      water_deposit_amount NUMERIC(12, 2) NOT NULL DEFAULT 0
        CHECK (water_deposit_amount >= 0),
      water_deposit_paid NUMERIC(12, 2) NOT NULL DEFAULT 0
        CHECK (water_deposit_paid >= 0),

      electricity_deposit_amount NUMERIC(12, 2) NOT NULL DEFAULT 0
        CHECK (electricity_deposit_amount >= 0),
      electricity_deposit_paid NUMERIC(12, 2) NOT NULL DEFAULT 0
        CHECK (electricity_deposit_paid >= 0),

      status VARCHAR(30) NOT NULL DEFAULT 'active',
      notes TEXT,
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      moved_out_at TIMESTAMPTZ,
      archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.query(`
    ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS rent_paid NUMERIC(12, 2)
    NOT NULL DEFAULT 0 CHECK (rent_paid >= 0);
  `);

  await db.query(`
    ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS rent_deposit_amount NUMERIC(12, 2)
    NOT NULL DEFAULT 0 CHECK (rent_deposit_amount >= 0);
  `);

  await db.query(`
    ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS rent_deposit_paid NUMERIC(12, 2)
    NOT NULL DEFAULT 0 CHECK (rent_deposit_paid >= 0);
  `);

  await db.query(`
    ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS water_deposit_amount NUMERIC(12, 2)
    NOT NULL DEFAULT 0 CHECK (water_deposit_amount >= 0);
  `);

  await db.query(`
    ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS water_deposit_paid NUMERIC(12, 2)
    NOT NULL DEFAULT 0 CHECK (water_deposit_paid >= 0);
  `);

  await db.query(`
    ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS electricity_deposit_amount NUMERIC(12, 2)
    NOT NULL DEFAULT 0 CHECK (electricity_deposit_amount >= 0);
  `);

  await db.query(`
    ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS electricity_deposit_paid NUMERIC(12, 2)
    NOT NULL DEFAULT 0 CHECK (electricity_deposit_paid >= 0);
  `);

  await db.query(`
    UPDATE tenants
    SET
      rent_deposit_amount = COALESCE(
        NULLIF(deposit_amount, 0),
        rent_deposit_amount
      ),
      rent_deposit_paid = COALESCE(
        NULLIF(deposit_paid, 0),
        rent_deposit_paid
      )
    WHERE EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'tenants'
        AND column_name = 'deposit_amount'
    );
  `).catch(() => null);

  await db.query(`
    ALTER TABLE tenants
    DROP CONSTRAINT IF EXISTS tenants_status_check;
  `);

  await db.query(`
    ALTER TABLE tenants
    ADD CONSTRAINT tenants_status_check
    CHECK (status IN ('active', 'moving_out', 'archived'));
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_tenants_owner_id
    ON tenants(owner_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_tenants_property_id
    ON tenants(property_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_tenants_unit_id
    ON tenants(unit_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_tenants_phone
    ON tenants(phone);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_tenants_status
    ON tenants(status);
  `);

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_active_tenant_per_unit
    ON tenants(unit_id)
    WHERE status IN ('active', 'moving_out');
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS tenant_payment_identities (
      id BIGSERIAL PRIMARY KEY,
      owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      account_for VARCHAR(30) NOT NULL,
      payment_channel VARCHAR(30) NOT NULL,
      raw_value VARCHAR(150) NOT NULL,
      normalized_value VARCHAR(150) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.query(`
    ALTER TABLE tenant_payment_identities
    DROP CONSTRAINT IF EXISTS tenant_payment_identities_account_for_check;
  `);

  await db.query(`
    ALTER TABLE tenant_payment_identities
    ADD CONSTRAINT tenant_payment_identities_account_for_check
    CHECK (account_for IN ('rent', 'water'));
  `);

  await db.query(`
    ALTER TABLE tenant_payment_identities
    DROP CONSTRAINT IF EXISTS tenant_payment_identities_payment_channel_check;
  `);

  await db.query(`
    ALTER TABLE tenant_payment_identities
    ADD CONSTRAINT tenant_payment_identities_payment_channel_check
    CHECK (payment_channel IN ('mpesa_phone', 'bank_reference'));
  `);

  await db.query(`
    ALTER TABLE tenant_payment_identities
    DROP CONSTRAINT IF EXISTS tenant_payment_identities_status_check;
  `);

  await db.query(`
    ALTER TABLE tenant_payment_identities
    ADD CONSTRAINT tenant_payment_identities_status_check
    CHECK (status IN ('active', 'inactive'));
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_tenant_payment_identities_owner_id
    ON tenant_payment_identities(owner_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_tenant_payment_identities_tenant_id
    ON tenant_payment_identities(tenant_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_tenant_payment_identities_lookup
    ON tenant_payment_identities(
      owner_id,
      account_for,
      payment_channel,
      normalized_value
    );
  `);

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_active_payment_identity_per_owner
    ON tenant_payment_identities(
      owner_id,
      account_for,
      payment_channel,
      normalized_value
    )
    WHERE status = 'active';
  `);

  await db.query(`
    DROP TRIGGER IF EXISTS update_tenants_updated_at ON tenants;
  `);

  await db.query(`
    CREATE TRIGGER update_tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  await db.query(`
    DROP TRIGGER IF EXISTS update_tenant_payment_identities_updated_at
    ON tenant_payment_identities;
  `);

  await db.query(`
    CREATE TRIGGER update_tenant_payment_identities_updated_at
    BEFORE UPDATE ON tenant_payment_identities
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  console.log('Tenant tables initialized successfully');
}

module.exports = initTenantTables;