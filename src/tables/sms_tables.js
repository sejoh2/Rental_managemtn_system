const db = require('../config/db');

async function initSmsTables() {
  // SMS Templates table
  await db.query(`
    CREATE TABLE IF NOT EXISTS sms_templates (
      id BIGSERIAL PRIMARY KEY,
      owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      content TEXT NOT NULL,
      is_default BOOLEAN NOT NULL DEFAULT false,
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // SMS Broadcasts table
  await db.query(`
    CREATE TABLE IF NOT EXISTS sms_broadcasts (
      id BIGSERIAL PRIMARY KEY,
      owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      template_id BIGINT REFERENCES sms_templates(id) ON DELETE SET NULL,
      name VARCHAR(100) NOT NULL,
      message TEXT NOT NULL,
      recipients_type VARCHAR(30) NOT NULL DEFAULT 'all',
      property_id BIGINT REFERENCES properties(id) ON DELETE SET NULL,
      recipient_ids JSONB DEFAULT '[]'::jsonb,
      status VARCHAR(30) NOT NULL DEFAULT 'draft',
      total_recipients INTEGER NOT NULL DEFAULT 0,
      total_sent INTEGER NOT NULL DEFAULT 0,
      total_delivered INTEGER NOT NULL DEFAULT 0,
      total_failed INTEGER NOT NULL DEFAULT 0,
      estimated_cost NUMERIC(12, 2) DEFAULT 0,
      actual_cost NUMERIC(12, 2) DEFAULT 0,
      scheduled_at TIMESTAMPTZ,
      sent_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Add status check constraint
  await db.query(`
    ALTER TABLE sms_broadcasts DROP CONSTRAINT IF EXISTS sms_broadcasts_status_check;
  `);

  await db.query(`
    ALTER TABLE sms_broadcasts
    ADD CONSTRAINT sms_broadcasts_status_check
    CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled', 'failed'));
  `);

  // Add recipients type check constraint
  await db.query(`
    ALTER TABLE sms_broadcasts DROP CONSTRAINT IF EXISTS sms_broadcasts_recipients_type_check;
  `);

  await db.query(`
    ALTER TABLE sms_broadcasts
    ADD CONSTRAINT sms_broadcasts_recipients_type_check
    CHECK (recipients_type IN ('all', 'property', 'arrears', 'credit', 'specific'));
  `);

  // SMS Messages table (individual messages)
  await db.query(`
    CREATE TABLE IF NOT EXISTS sms_messages (
      id BIGSERIAL PRIMARY KEY,
      owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      broadcast_id BIGINT REFERENCES sms_broadcasts(id) ON DELETE SET NULL,
      tenant_id BIGINT REFERENCES tenants(id) ON DELETE SET NULL,
      recipient_phone VARCHAR(30) NOT NULL,
      message TEXT NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      status_reason VARCHAR(255),
      cost NUMERIC(12, 2) DEFAULT 0,
      scheduled_at TIMESTAMPTZ,
      sent_at TIMESTAMPTZ,
      delivered_at TIMESTAMPTZ,
      failed_at TIMESTAMPTZ,
      provider_message_id VARCHAR(100),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Add status check constraint for messages
  await db.query(`
    ALTER TABLE sms_messages DROP CONSTRAINT IF EXISTS sms_messages_status_check;
  `);

  await db.query(`
    ALTER TABLE sms_messages
    ADD CONSTRAINT sms_messages_status_check
    CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'scheduled', 'cancelled'));
  `);

  // Indexes
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sms_templates_owner_id ON sms_templates(owner_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sms_broadcasts_owner_id ON sms_broadcasts(owner_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sms_broadcasts_status ON sms_broadcasts(status);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sms_broadcasts_scheduled_at ON sms_broadcasts(scheduled_at);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sms_messages_owner_id ON sms_messages(owner_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sms_messages_broadcast_id ON sms_messages(broadcast_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sms_messages_tenant_id ON sms_messages(tenant_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sms_messages_status ON sms_messages(status);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sms_messages_scheduled_at ON sms_messages(scheduled_at);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sms_messages_provider_message_id ON sms_messages(provider_message_id);`);

  // Triggers
  await db.query(`
    DROP TRIGGER IF EXISTS update_sms_templates_updated_at ON sms_templates;
  `);

  await db.query(`
    CREATE TRIGGER update_sms_templates_updated_at
    BEFORE UPDATE ON sms_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  await db.query(`
    DROP TRIGGER IF EXISTS update_sms_broadcasts_updated_at ON sms_broadcasts;
  `);

  await db.query(`
    CREATE TRIGGER update_sms_broadcasts_updated_at
    BEFORE UPDATE ON sms_broadcasts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  await db.query(`
    DROP TRIGGER IF EXISTS update_sms_messages_updated_at ON sms_messages;
  `);

  await db.query(`
    CREATE TRIGGER update_sms_messages_updated_at
    BEFORE UPDATE ON sms_messages
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  console.log('SMS tables initialized successfully');
}

module.exports = initSmsTables;