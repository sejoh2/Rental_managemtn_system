const db = require("../config/db");


async function log_audit({
    user_id,
    action,
    entity_type,
    entity_id,
    metadata,
    ip_address,
}) {

    await db.query(
        `
        INSERT INTO audit_logs (
            user_id,
            action,
            entity_type,
            entity_id,
            metadata,
            ip_address
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        `,
        [
            user_id || null,
            action,
            entity_type || null,
            entity_id || null,
            metadata
                ? JSON.stringify(metadata)
                : null,
            ip_address || null,
        ]
    );
}


module.exports = {
    log_audit,
};