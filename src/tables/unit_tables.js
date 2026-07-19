const db = require('../config/db');

async function initUnitTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS units (
      id BIGSERIAL PRIMARY KEY,
      owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      unit_number VARCHAR(100) NOT NULL,
      floor VARCHAR(100),
      unit_type VARCHAR(50) NOT NULL DEFAULT 'single_room',
      monthly_rent NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (monthly_rent >= 0),
      deposit_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
      water_meter_number VARCHAR(100),
      status VARCHAR(30) NOT NULL DEFAULT 'vacant',
      notes TEXT,
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(property_id, unit_number)
    );
  `);

  await db.query(`ALTER TABLE units DROP CONSTRAINT IF EXISTS units_unit_type_check;`);
  await db.query(`
    ALTER TABLE units
    ADD CONSTRAINT units_unit_type_check
    CHECK (
      unit_type IN (
        'single_room',
        'bedsitter',
        'one_bedroom',
        'two_bedroom',
        'three_bedroom',
        'shop',
        'other'
      )
    );
  `);

  await db.query(`ALTER TABLE units DROP CONSTRAINT IF EXISTS units_status_check;`);
  await db.query(`
    ALTER TABLE units
    ADD CONSTRAINT units_status_check
    CHECK (status IN ('vacant', 'occupied', 'maintenance', 'archived'));
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_units_owner_id ON units(owner_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_units_property_id ON units(property_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_units_status ON units(status);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_units_unit_number ON units(unit_number);`);

  await db.query(`DROP TRIGGER IF EXISTS update_units_updated_at ON units;`);
  await db.query(`
    CREATE TRIGGER update_units_updated_at
    BEFORE UPDATE ON units
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  console.log('Unit tables initialized successfully');
}

module.exports = initUnitTables;