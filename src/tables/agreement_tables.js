const db = require('../config/db');

async function initAgreementTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS agreement_templates (
      id BIGSERIAL PRIMARY KEY,
      owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      property_id BIGINT REFERENCES properties(id) ON DELETE CASCADE,
      name VARCHAR(150) NOT NULL DEFAULT 'Default tenancy agreement',
      template_text TEXT NOT NULL,
      is_default BOOLEAN NOT NULL DEFAULT true,
      status VARCHAR(30) NOT NULL DEFAULT 'active',
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.query(`
    ALTER TABLE agreement_templates DROP CONSTRAINT IF EXISTS agreement_templates_status_check;
  `);

  await db.query(`
    ALTER TABLE agreement_templates
    ADD CONSTRAINT agreement_templates_status_check
    CHECK (status IN ('active', 'archived'));
  `);

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_default_agreement_template_per_scope
    ON agreement_templates(owner_id, COALESCE(property_id, 0))
    WHERE is_default = true AND status = 'active';
  `);

  await db.query(`
    DROP TRIGGER IF EXISTS update_agreement_templates_updated_at ON agreement_templates;
  `);

  await db.query(`
    CREATE TRIGGER update_agreement_templates_updated_at
    BEFORE UPDATE ON agreement_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  console.log('Agreement tables initialized successfully');
}

module.exports = initAgreementTables;