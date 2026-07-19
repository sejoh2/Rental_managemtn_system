const db = require('../config/db');

async function logAudit({ userId, action, entityType, entityId, metadata, ipAddress }) {
  await db.query(
    `
    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      userId || null,
      action,
      entityType || null,
      entityId || null,
      metadata ? JSON.stringify(metadata) : null,
      ipAddress || null,
    ]
  );
}

module.exports = {
  logAudit,
};