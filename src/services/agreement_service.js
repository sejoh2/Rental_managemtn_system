const db = require('../config/db');
const { logAudit } = require('./audit_service');

const DEFAULT_TEMPLATE = `TENANCY AGREEMENT

Landlord: {landlord_name}
Tenant: {tenant_name}
Property: {property_name}, House {unit_number}
Monthly rent: KES {monthly_rent}
Rent deposit: KES {rent_deposit}
Electricity deposit: KES {electricity_deposit}
Rent due: {rent_due_day} of every month
Water: {water_billing}
Notice period: 30 days

Signature: ________________________`;

function formatMoney(amount) {
  return Number(amount || 0).toLocaleString('en-KE');
}

function getOwnerScope(user) {
  if (user.role === 'admin') return null;
  if (user.role === 'caretaker') return user.owner_id;
  return user.id;
}

function publicTemplate(row) {
  return {
    id: Number(row.id),
    owner_id: Number(row.owner_id),
    property_id: row.property_id ? Number(row.property_id) : null,
    name: row.name,
    template_text: row.template_text,
    is_default: row.is_default,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function ensureDefaultTemplate(ownerId, userId) {
  const result = await db.query(
    `
    SELECT *
    FROM agreement_templates
    WHERE owner_id = $1
      AND property_id IS NULL
      AND is_default = true
      AND status = 'active'
    LIMIT 1
    `,
    [ownerId]
  );

  if (result.rows[0]) return result.rows[0];

  const created = await db.query(
    `
    INSERT INTO agreement_templates (
      owner_id,
      property_id,
      name,
      template_text,
      is_default,
      created_by
    )
    VALUES ($1, NULL, 'Default tenancy agreement', $2, true, $3)
    RETURNING *
    `,
    [ownerId, DEFAULT_TEMPLATE, userId || null]
  );

  return created.rows[0];
}

async function getTemplateForTenant(user, tenantId) {
  const ownerId = getOwnerScope(user);

  const tenantResult = ownerId
    ? await db.query(
        `
        SELECT t.owner_id, t.property_id
        FROM tenants t
        WHERE t.id = $1
          AND t.owner_id = $2
          AND t.status != 'archived'
        `,
        [tenantId, ownerId]
      )
    : await db.query(
        `
        SELECT t.owner_id, t.property_id
        FROM tenants t
        WHERE t.id = $1
          AND t.status != 'archived'
        `,
        [tenantId]
      );

  const tenant = tenantResult.rows[0];

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const templateResult = await db.query(
    `
    SELECT *
    FROM agreement_templates
    WHERE owner_id = $1
      AND status = 'active'
      AND is_default = true
      AND (property_id = $2 OR property_id IS NULL)
    ORDER BY property_id NULLS LAST
    LIMIT 1
    `,
    [tenant.owner_id, tenant.property_id]
  );

  return templateResult.rows[0] || ensureDefaultTemplate(tenant.owner_id, user.id);
}

async function listTemplates(user) {
  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        SELECT *
        FROM agreement_templates
        WHERE owner_id = $1
          AND status = 'active'
        ORDER BY created_at DESC
        `,
        [ownerId]
      )
    : await db.query(
        `
        SELECT *
        FROM agreement_templates
        WHERE status = 'active'
        ORDER BY created_at DESC
        `
      );

  if (!result.rows.length && ownerId) {
    const template = await ensureDefaultTemplate(ownerId, user.id);
    return [publicTemplate(template)];
  }

  return result.rows.map(publicTemplate);
}

async function saveTemplate(user, data, ipAddress) {
  if (!['admin', 'owner'].includes(user.role)) {
    throw new Error('Only owners can manage agreement templates');
  }

  const ownerId = user.role === 'owner' ? user.id : data.owner_id;

  if (!ownerId) {
    throw new Error('Owner is required');
  }

  const result = await db.query(
    `
    INSERT INTO agreement_templates (
      owner_id,
      property_id,
      name,
      template_text,
      is_default,
      created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (owner_id, COALESCE(property_id, 0))
    WHERE is_default = true AND status = 'active'
    DO UPDATE SET
      name = EXCLUDED.name,
      template_text = EXCLUDED.template_text,
      is_default = EXCLUDED.is_default,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
    `,
    [
      ownerId,
      data.property_id || null,
      data.name,
      data.template_text,
      data.is_default,
      user.id,
    ]
  );

  await logAudit({
    userId: user.id,
    action: 'AGREEMENT_TEMPLATE_SAVED',
    entityType: 'agreement_template',
    entityId: result.rows[0].id,
    metadata: {
      property_id: data.property_id || null,
    },
    ipAddress,
  });

  return publicTemplate(result.rows[0]);
}

function renderAgreement(templateText, tenant) {
  const values = {
    landlord_name: tenant.owner_name || 'Property owner',
    tenant_name: tenant.full_name,
    property_name: tenant.property_name,
    unit_number: tenant.unit_number,
    monthly_rent: formatMoney(tenant.monthly_rent),
    rent_deposit: formatMoney(tenant.rent_deposit_amount),
    electricity_deposit: formatMoney(tenant.electricity_deposit_amount),
    rent_due_day: tenant.rent_due_day || '5th',
    water_billing: tenant.water_billing_label || 'Billed separately per meter reading',
    notice_period: '30',
    move_in_date: tenant.move_in_date || '',
  };

  return templateText.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    return values[key] ?? `{${key}}`;
  });
}

async function generateTenantAgreement(user, tenantId) {
  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        SELECT
          t.*,
          p.name AS property_name,
          p.rent_due_day,
          p.water_billing_method,
          u.unit_number,
          CONCAT(owner.first_name, ' ', owner.last_name) AS owner_name
        FROM tenants t
        INNER JOIN properties p ON p.id = t.property_id
        INNER JOIN units u ON u.id = t.unit_id
        INNER JOIN users owner ON owner.id = t.owner_id
        WHERE t.id = $1
          AND t.owner_id = $2
          AND t.status != 'archived'
        LIMIT 1
        `,
        [tenantId, ownerId]
      )
    : await db.query(
        `
        SELECT
          t.*,
          p.name AS property_name,
          p.rent_due_day,
          p.water_billing_method,
          u.unit_number,
          CONCAT(owner.first_name, ' ', owner.last_name) AS owner_name
        FROM tenants t
        INNER JOIN properties p ON p.id = t.property_id
        INNER JOIN units u ON u.id = t.unit_id
        INNER JOIN users owner ON owner.id = t.owner_id
        WHERE t.id = $1
          AND t.status != 'archived'
        LIMIT 1
        `,
        [tenantId]
      );

  const tenant = result.rows[0];

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const template = await getTemplateForTenant(user, tenantId);
  const agreementText = renderAgreement(template.template_text, tenant);

  return {
    tenant_id: Number(tenant.id),
    tenant_name: tenant.full_name,
    status: 'signed',
    signed_at: tenant.move_in_date,
    template_id: Number(template.id),
    agreement_text: agreementText,
  };
}

module.exports = {
  listTemplates,
  saveTemplate,
  generateTenantAgreement,
};