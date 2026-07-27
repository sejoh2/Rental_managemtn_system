const db = require('../config/db');
const { normalizePhone } = require('../utils/phone');
const { logAudit } = require('./audit_service');

const DEFAULT_WATER_DEPOSIT = Number(process.env.DEFAULT_WATER_DEPOSIT_AMOUNT) || 2000;
const DEFAULT_ELECTRICITY_DEPOSIT = Number(process.env.DEFAULT_ELECTRICITY_DEPOSIT_AMOUNT) || 0;

function formatMoney(amount) {
  return `KES ${Number(amount || 0).toLocaleString('en-KE')}`;
}

function getOwnerScope(user) {
  if (user.role === 'admin') return null;
  if (user.role === 'caretaker') return user.owner_id;
  return user.id;
}

function normalizeBankReference(value) {
  if (!value) return null;
  return String(value).trim().toUpperCase().replace(/\s+/g, '');
}

function splitName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/);
  return {
    first_name: parts[0] || '',
    last_name: parts.slice(1).join(' ') || '',
  };
}

function publicTenant(row) {
  // ============================================================
  // RENT
  // ============================================================

  const monthlyRent = Number(row.monthly_rent || 0);
  const rentPaidAmount = Number(row.rent_paid_calculated || 0);
  const rentBalanceAmount = monthlyRent - rentPaidAmount;

  // ============================================================
  // RENT DEPOSIT
  // ============================================================

  const rentDepositAmount = Number(row.rent_deposit_amount || 0);
  const rentDepositPaid = Number(
    row.rent_deposit_paid_calculated || 0
  );

  const rentDepositBalance = Math.max(
    rentDepositAmount - rentDepositPaid,
    0
  );

  // ============================================================
  // WATER
  // ============================================================

  const waterBillAmount = Number(row.water_bill_amount || 0);
  const waterPaidAmount = Number(row.water_paid_calculated || 0);

  const waterBalanceAmount = Number(
  row.water_balance_calculated || 0
);

  // ============================================================
  // WATER DEPOSIT
  // ============================================================

  const waterDepositAmount = Number(row.water_deposit_amount || 0);
  const waterDepositPaid = Number(
    row.water_deposit_paid_calculated || 0
  );

  const waterDepositBalance = Math.max(
    waterDepositAmount - waterDepositPaid,
    0
  );

  // ============================================================
  // ELECTRICITY DEPOSIT
  // ============================================================

  const electricityDepositAmount = Number(
    row.electricity_deposit_amount || 0
  );

  const electricityDepositPaid = Number(
    row.electricity_deposit_paid_calculated || 0
  );

  const electricityDepositBalance = Math.max(
    electricityDepositAmount - electricityDepositPaid,
    0
  );

  // ============================================================
  // TOTALS
  // ============================================================

  const totalPaidAmount =
    rentPaidAmount +
    rentDepositPaid +
    waterPaidAmount +
    waterDepositPaid +
    electricityDepositPaid;

  const totalBalanceAmount =
    rentBalanceAmount +
    rentDepositBalance +
    waterBalanceAmount +
    waterDepositBalance +
    electricityDepositBalance;

  // ============================================================
  // RENT STATUS
  // ============================================================

  const rentStatus =
    rentBalanceAmount > 0
      ? 'partial'
      : rentBalanceAmount < 0
        ? 'advance_credit'
        : 'paid';

  const rentStatusLabel =
    rentBalanceAmount > 0
      ? 'Partial'
      : rentBalanceAmount < 0
        ? 'Advance credit'
        : 'Paid';

  // ============================================================
  // RESPONSE
  // ============================================================

  return {
    id: Number(row.id),
    owner_id: Number(row.owner_id),

    property_id: Number(row.property_id),
    property_name: row.property_name,

    unit_id: Number(row.unit_id),
    unit_number: row.unit_number,

    full_name: row.full_name,
    name: row.full_name,

    phone: row.phone,
    id_number: row.id_number,
    move_in_date: row.move_in_date,

    // Rent
    monthly_rent: monthlyRent,
    monthly_rent_display: formatMoney(monthlyRent),

    rent_paid_amount: rentPaidAmount,
    rent_paid_display: formatMoney(rentPaidAmount),

    rent_balance_amount: rentBalanceAmount,
    rent_balance_display:
      rentBalanceAmount < 0
        ? `+ ${formatMoney(Math.abs(rentBalanceAmount))}`
        : formatMoney(rentBalanceAmount),

    // Rent deposit
    rent_deposit_amount: rentDepositAmount,
    rent_deposit_display: formatMoney(rentDepositAmount),

    rent_deposit_paid: rentDepositPaid,
    rent_deposit_paid_display: formatMoney(rentDepositPaid),

    rent_deposit_balance: rentDepositBalance,
    rent_deposit_balance_display: formatMoney(rentDepositBalance),

    // Water
    water_bill_amount: waterBillAmount,
    water_bill_display: formatMoney(waterBillAmount),

    water_paid_amount: waterPaidAmount,
    water_paid_display: formatMoney(waterPaidAmount),

    water_balance_amount: waterBalanceAmount,
    water_balance_display: formatMoney(waterBalanceAmount),

    // Water deposit
    water_deposit_amount: waterDepositAmount,
    water_deposit_display: formatMoney(waterDepositAmount),

    water_deposit_paid: waterDepositPaid,
    water_deposit_paid_display: formatMoney(waterDepositPaid),

    water_deposit_balance: waterDepositBalance,
    water_deposit_balance_display: formatMoney(waterDepositBalance),

    // Electricity deposit
    electricity_deposit_amount: electricityDepositAmount,
    electricity_deposit_display: formatMoney(
      electricityDepositAmount
    ),

    electricity_deposit_paid: electricityDepositPaid,
    electricity_deposit_paid_display: formatMoney(
      electricityDepositPaid
    ),

    electricity_deposit_balance: electricityDepositBalance,
    electricity_deposit_balance_display: formatMoney(
      electricityDepositBalance
    ),

    // Overall financial position
    total_paid_amount: totalPaidAmount,
    total_paid_display: formatMoney(totalPaidAmount),

    total_balance_amount: totalBalanceAmount,
    total_balance_display: formatMoney(totalBalanceAmount),

    status: row.status,

    rent_status: rentStatus,
    rent_status_label: rentStatusLabel,

    unit:
      `${row.property_short_name || row.property_name} · ${row.unit_number}`,

    notes: row.notes,

    payment_identity: {
      rent_payment_phone: row.rent_payment_phone,
      rent_bank_reference: row.rent_bank_reference,
      water_payment_phone: row.water_payment_phone,
      water_bank_reference: row.water_bank_reference,
    },

    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
function baseTenantSelect(whereClause = '') {
  return `
    SELECT
      t.*,
      p.name AS property_name,
      SPLIT_PART(p.name, ' ', 1) AS property_short_name,
      u.unit_number,

      -- ========================================================
      -- RENT PAYMENTS
      -- ========================================================

      COALESCE(
        rent_payments.total,
        0
      )::NUMERIC AS rent_paid_calculated,

      -- ========================================================
      -- RENT DEPOSIT PAYMENTS
      -- ========================================================

      COALESCE(
        rent_deposit_payments.total,
        0
      )::NUMERIC AS rent_deposit_paid_calculated,

      -- ========================================================
      -- ELECTRICITY DEPOSIT PAYMENTS
      -- ========================================================

      COALESCE(
        electricity_deposit_payments.total,
        0
      )::NUMERIC AS electricity_deposit_paid_calculated,

      -- ========================================================
      -- WATER DEPOSIT PAYMENTS
      -- ========================================================

      COALESCE(
        water_deposit_payments.total,
        0
      )::NUMERIC AS water_deposit_paid_calculated,

      -- ========================================================
      -- WATER BILLS
      -- ========================================================

      COALESCE(
        water_bill_totals.total_amount,
        0
      )::NUMERIC AS water_bill_amount,

      COALESCE(
        water_bill_totals.amount_paid,
        0
      )::NUMERIC AS water_paid_calculated,

      COALESCE(
        water_bill_totals.balance,
        0
      )::NUMERIC AS water_balance_calculated,

      -- ========================================================
      -- PAYMENT IDENTITIES
      -- ========================================================

      rent_phone.raw_value AS rent_payment_phone,
      rent_ref.raw_value AS rent_bank_reference,

      water_phone.raw_value AS water_payment_phone,
      water_ref.raw_value AS water_bank_reference

    FROM tenants t

    INNER JOIN properties p
      ON p.id = t.property_id

    INNER JOIN units u
      ON u.id = t.unit_id

    -- ==========================================================
    -- RENT PAYMENTS
    -- ==========================================================

    LEFT JOIN (
      SELECT
        tenant_id,
        SUM(amount) AS total
      FROM payments
      WHERE status = 'matched'
        AND apply_to = 'rent_balance'
      GROUP BY tenant_id
    ) rent_payments
      ON rent_payments.tenant_id = t.id

    -- ==========================================================
    -- RENT DEPOSIT PAYMENTS
    -- ==========================================================

    LEFT JOIN (
      SELECT
        tenant_id,
        SUM(amount) AS total
      FROM payments
      WHERE status = 'matched'
        AND apply_to = 'rent_deposit'
      GROUP BY tenant_id
    ) rent_deposit_payments
      ON rent_deposit_payments.tenant_id = t.id

    -- ==========================================================
    -- ELECTRICITY DEPOSIT PAYMENTS
    -- ==========================================================

    LEFT JOIN (
      SELECT
        tenant_id,
        SUM(amount) AS total
      FROM payments
      WHERE status = 'matched'
        AND apply_to = 'electricity_deposit'
      GROUP BY tenant_id
    ) electricity_deposit_payments
      ON electricity_deposit_payments.tenant_id = t.id

    -- ==========================================================
    -- WATER DEPOSIT PAYMENTS
    -- ==========================================================

    LEFT JOIN (
      SELECT
        tenant_id,
        SUM(amount) AS total
      FROM payments
      WHERE status = 'matched'
        AND apply_to = 'water_deposit'
      GROUP BY tenant_id
    ) water_deposit_payments
      ON water_deposit_payments.tenant_id = t.id

    -- ==========================================================
    -- WATER BILL TOTALS
    -- ==========================================================

    LEFT JOIN (
      SELECT
        tenant_id,

        SUM(total_amount) AS total_amount,

        SUM(amount_paid) AS amount_paid,

        SUM(balance) AS balance

      FROM water_bills

      WHERE status != 'cancelled'

      GROUP BY tenant_id
    ) water_bill_totals
      ON water_bill_totals.tenant_id = t.id

    -- ==========================================================
    -- RENT PAYMENT PHONE
    -- ==========================================================

    LEFT JOIN tenant_payment_identities rent_phone
      ON rent_phone.tenant_id = t.id
      AND rent_phone.account_for = 'rent'
      AND rent_phone.payment_channel = 'mpesa_phone'
      AND rent_phone.status = 'active'

    -- ==========================================================
    -- RENT BANK REFERENCE
    -- ==========================================================

    LEFT JOIN tenant_payment_identities rent_ref
      ON rent_ref.tenant_id = t.id
      AND rent_ref.account_for = 'rent'
      AND rent_ref.payment_channel = 'bank_reference'
      AND rent_ref.status = 'active'

    -- ==========================================================
    -- WATER PAYMENT PHONE
    -- ==========================================================

    LEFT JOIN tenant_payment_identities water_phone
      ON water_phone.tenant_id = t.id
      AND water_phone.account_for = 'water'
      AND water_phone.payment_channel = 'mpesa_phone'
      AND water_phone.status = 'active'

    -- ==========================================================
    -- WATER BANK REFERENCE
    -- ==========================================================

    LEFT JOIN tenant_payment_identities water_ref
      ON water_ref.tenant_id = t.id
      AND water_ref.account_for = 'water'
      AND water_ref.payment_channel = 'bank_reference'
      AND water_ref.status = 'active'

    ${whereClause}
  `;
}

async function assertPropertyAccess(user, propertyId) {
  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        SELECT id, owner_id, name
        FROM properties
        WHERE id = $1
          AND owner_id = $2
          AND status = 'active'
        `,
        [propertyId, ownerId]
      )
    : await db.query(
        `
        SELECT id, owner_id, name
        FROM properties
        WHERE id = $1
          AND status = 'active'
        `,
        [propertyId]
      );

  const property = result.rows[0];

  if (!property) {
    throw new Error('Property not found or you do not have access to it');
  }

  return property;
}

async function assertUnitAccess(user, unitId, propertyId) {
  const ownerId = getOwnerScope(user);

  const params = [unitId];
  const conditions = [`u.id = $1`, `u.status != 'archived'`];

  if (ownerId) {
    params.push(ownerId);
    conditions.push(`u.owner_id = $${params.length}`);
  }

  if (propertyId) {
    params.push(propertyId);
    conditions.push(`u.property_id = $${params.length}`);
  }

  const result = await db.query(
    `
    SELECT u.*, p.name AS property_name
    FROM units u
    INNER JOIN properties p ON p.id = u.property_id
    WHERE ${conditions.join(' AND ')}
    LIMIT 1
    `,
    params
  );

  const unit = result.rows[0];

  if (!unit) {
    throw new Error('Unit not found or you do not have access to it');
  }

  return unit;
}

async function listTenants(user, filters = {}) {
  const ownerId = getOwnerScope(user);
  const conditions = [];
  const params = [];

  if (ownerId) {
    params.push(ownerId);
    conditions.push(`t.owner_id = $${params.length}`);
  }

  if (filters.status && filters.status !== 'all') {
    params.push(filters.status);
    conditions.push(`t.status = $${params.length}`);
  } else {
    conditions.push(`t.status != 'archived'`);
  }

  if (filters.property_id) {
    await assertPropertyAccess(user, filters.property_id);

    params.push(filters.property_id);
    conditions.push(`t.property_id = $${params.length}`);
  }

  if (filters.unit_id) {
    await assertUnitAccess(user, filters.unit_id);

    params.push(filters.unit_id);
    conditions.push(`t.unit_id = $${params.length}`);
  }

  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(`(t.full_name ILIKE $${params.length} OR t.phone ILIKE $${params.length} OR u.unit_number ILIKE $${params.length})`);
  }

  const result = await db.query(
    `
    ${baseTenantSelect(`WHERE ${conditions.join(' AND ')}`)}
    ORDER BY t.created_at DESC
    `,
    params
  );

  let tenants = result.rows.map(publicTenant);

  if (filters.balance === 'in_arrears') {
  tenants = tenants.filter(
    (tenant) => tenant.rent_balance_amount > 0
  );
}

if (filters.balance === 'credit') {
  tenants = tenants.filter(
    (tenant) => tenant.rent_balance_amount < 0
  );
}

if (filters.balance === 'paid') {
  tenants = tenants.filter(
    (tenant) => tenant.rent_balance_amount === 0
  );
}

  return {
    tenants,
    summary: buildTenantSummary(tenants),
  };
}

function buildTenantSummary(tenants) {
  return {
    all: tenants.length,

    in_arrears: tenants.filter(
      (tenant) => tenant.rent_balance_amount > 0
    ).length,

    credit_balance: tenants.filter(
      (tenant) => tenant.rent_balance_amount < 0
    ).length,

    moving_out: tenants.filter(
      (tenant) => tenant.status === 'moving_out'
    ).length,

    paid: tenants.filter(
      (tenant) => tenant.rent_balance_amount === 0
    ).length,
  };
}

async function getTenantById(user, tenantId) {
  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        ${baseTenantSelect('WHERE t.id = $1 AND t.owner_id = $2')}
        LIMIT 1
        `,
        [tenantId, ownerId]
      )
    : await db.query(
        `
        ${baseTenantSelect('WHERE t.id = $1')}
        LIMIT 1
        `,
        [tenantId]
      );

  return result.rows[0] ? publicTenant(result.rows[0]) : null;
}

async function replacePaymentIdentities(client, ownerId, tenantId, data) {
  await client.query(
    `
    UPDATE tenant_payment_identities
    SET status = 'inactive'
    WHERE tenant_id = $1
    `,
    [tenantId]
  );

  const identities = [
    {
      account_for: 'rent',
      payment_channel: 'mpesa_phone',
      raw_value: data.rent_payment_phone,
      normalized_value: normalizePhone(data.rent_payment_phone),
    },
    {
      account_for: 'rent',
      payment_channel: 'bank_reference',
      raw_value: data.rent_bank_reference,
      normalized_value: normalizeBankReference(data.rent_bank_reference),
    },
    {
      account_for: 'water',
      payment_channel: 'mpesa_phone',
      raw_value: data.water_payment_phone,
      normalized_value: normalizePhone(data.water_payment_phone),
    },
    {
      account_for: 'water',
      payment_channel: 'bank_reference',
      raw_value: data.water_bank_reference,
      normalized_value: normalizeBankReference(data.water_bank_reference),
    },
  ].filter((identity) => identity.raw_value && identity.normalized_value);

  for (const identity of identities) {
    await client.query(
      `
      INSERT INTO tenant_payment_identities (
        owner_id,
        tenant_id,
        account_for,
        payment_channel,
        raw_value,
        normalized_value
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        ownerId,
        tenantId,
        identity.account_for,
        identity.payment_channel,
        identity.raw_value,
        identity.normalized_value,
      ]
    );
  }
}

async function createTenant(user, data, ipAddress) {
  if (!['admin', 'owner', 'caretaker'].includes(user.role)) {
    throw new Error('You are not allowed to create tenants');
  }

  const property = await assertPropertyAccess(user, data.property_id);
  const unit = await assertUnitAccess(user, data.unit_id, data.property_id);

  if (unit.status === 'occupied') {
    throw new Error('This unit is already occupied');
  }

  const normalizedPhone = normalizePhone(data.phone);

  if (!normalizedPhone) {
    throw new Error('A valid tenant phone number is required');
  }

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Rent deposit = monthly rent (by default)
    const monthlyRent = data.monthly_rent || unit.monthly_rent || 0;
    const rentDepositAmount = data.rent_deposit_amount || monthlyRent;

    const tenantResult = await client.query(
      `
      INSERT INTO tenants (
        owner_id,
        property_id,
        unit_id,
        full_name,
        phone,
        id_number,
        move_in_date,
        monthly_rent,
        rent_paid,
        rent_deposit_amount,
        rent_deposit_paid,
        electricity_deposit_amount,
        electricity_deposit_paid,
        water_deposit_amount,
        water_deposit_paid,
        notes,
        created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *
      `,
      [
        property.owner_id,
        data.property_id,
        data.unit_id,
        data.full_name,
        normalizedPhone,
        data.id_number || null,
        data.move_in_date || null,
        monthlyRent,
        data.rent_paid || 0,
        rentDepositAmount,  // Rent deposit = monthly rent
        data.rent_deposit_paid || 0,
        data.electricity_deposit_amount || DEFAULT_ELECTRICITY_DEPOSIT,
        data.electricity_deposit_paid || 0,
        data.water_deposit_amount || DEFAULT_WATER_DEPOSIT,
        data.water_deposit_paid || 0,
        data.notes || null,
        user.id,
      ]
    );

    const tenant = tenantResult.rows[0];

    await replacePaymentIdentities(client, property.owner_id, tenant.id, {
      rent_payment_phone: data.rent_payment_phone || data.phone,
      rent_bank_reference: data.rent_bank_reference,
      water_payment_phone: data.water_payment_phone || data.phone,
      water_bank_reference: data.water_bank_reference,
    });

    await client.query(
      `
      UPDATE units
      SET status = 'occupied'
      WHERE id = $1
        AND owner_id = $2
      `,
      [data.unit_id, property.owner_id]
    );

    await client.query('COMMIT');

    await logAudit({
      userId: user.id,
      action: 'TENANT_CREATED',
      entityType: 'tenant',
      entityId: tenant.id,
      metadata: {
        tenant_name: tenant.full_name,
        property_id: data.property_id,
        unit_id: data.unit_id,
        unit_number: unit.unit_number,
        rent_deposit_amount: rentDepositAmount,
        water_deposit_amount: data.water_deposit_amount || DEFAULT_WATER_DEPOSIT,
      },
      ipAddress,
    });

    return getTenantById(user, tenant.id);
  } catch (error) {
    await client.query('ROLLBACK');

    if (error.code === '23505') {
      throw new Error('This payment identity or unit is already linked to another active tenant');
    }

    throw error;
  } finally {
    client.release();
  }
}

async function updateTenant(user, tenantId, data, ipAddress) {
  const existing = await getTenantById(user, tenantId);

  if (!existing) {
    throw new Error('Tenant not found');
  }

  let nextPropertyId = existing.property_id;
  let nextUnitId = existing.unit_id;

  if (data.property_id) {
    const property = await assertPropertyAccess(user, data.property_id);
    nextPropertyId = Number(property.id);
  }

  if (data.unit_id) {
    const unit = await assertUnitAccess(user, data.unit_id, nextPropertyId);

    if (Number(unit.id) !== existing.unit_id && unit.status === 'occupied') {
      throw new Error('The selected unit is already occupied');
    }

    nextUnitId = Number(unit.id);
  }

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    await client.query(
      `
      UPDATE tenants
      SET
        property_id = $1,
        unit_id = $2,
        full_name = COALESCE($3, full_name),
        phone = COALESCE($4, phone),
        id_number = COALESCE($5, id_number),
        move_in_date = COALESCE($6, move_in_date),
        monthly_rent = COALESCE($7, monthly_rent),
        rent_paid = COALESCE($8, rent_paid),
        rent_deposit_amount = COALESCE($9, rent_deposit_amount),
        rent_deposit_paid = COALESCE($10, rent_deposit_paid),
        electricity_deposit_amount = COALESCE($11, electricity_deposit_amount),
        electricity_deposit_paid = COALESCE($12, electricity_deposit_paid),
        water_deposit_amount = COALESCE($13, water_deposit_amount),
        water_deposit_paid = COALESCE($14, water_deposit_paid),
        status = COALESCE($15, status),
        notes = COALESCE($16, notes)
      WHERE id = $17
        AND owner_id = $18
      `,
      [
        nextPropertyId,
        nextUnitId,
        data.full_name || null,
        data.phone ? normalizePhone(data.phone) : null,
        data.id_number || null,
        data.move_in_date || null,
        data.monthly_rent ?? null,
        data.rent_paid ?? null,
        data.rent_deposit_amount ?? null,
        data.rent_deposit_paid ?? null,
        data.electricity_deposit_amount ?? null,
        data.electricity_deposit_paid ?? null,
        data.water_deposit_amount ?? null,
        data.water_deposit_paid ?? null,
        data.status || null,
        data.notes || null,
        tenantId,
        existing.owner_id,
      ]
    );

    if (nextUnitId !== existing.unit_id) {
      await client.query(
        `
        UPDATE units
        SET status = 'vacant'
        WHERE id = $1
          AND owner_id = $2
        `,
        [existing.unit_id, existing.owner_id]
      );

      await client.query(
        `
        UPDATE units
        SET status = 'occupied'
        WHERE id = $1
          AND owner_id = $2
        `,
        [nextUnitId, existing.owner_id]
      );
    }

    const paymentFields = [
      'rent_payment_phone',
      'rent_bank_reference',
      'water_payment_phone',
      'water_bank_reference',
    ];

    const shouldUpdateIdentities = paymentFields.some((field) =>
      Object.prototype.hasOwnProperty.call(data, field)
    );

    if (shouldUpdateIdentities) {
      await replacePaymentIdentities(client, existing.owner_id, tenantId, data);
    }

    await client.query('COMMIT');

    await logAudit({
      userId: user.id,
      action: 'TENANT_UPDATED',
      entityType: 'tenant',
      entityId: tenantId,
      metadata: data,
      ipAddress,
    });

    return getTenantById(user, tenantId);
  } catch (error) {
    await client.query('ROLLBACK');

    if (error.code === '23505') {
      throw new Error('This payment identity or unit is already linked to another active tenant');
    }

    throw error;
  } finally {
    client.release();
  }
}

async function moveOutTenant(user, tenantId, data, ipAddress) {
  const existing = await getTenantById(user, tenantId);

  if (!existing) {
    throw new Error('Tenant not found');
  }

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    await client.query(
      `
      UPDATE tenants
      SET status = 'archived',
          moved_out_at = COALESCE($1::TIMESTAMPTZ, CURRENT_TIMESTAMP),
          archived_at = CURRENT_TIMESTAMP,
          notes = COALESCE($2, notes)
      WHERE id = $3
        AND owner_id = $4
      `,
      [
        data.move_out_date || null,
        data.reason || null,
        tenantId,
        existing.owner_id,
      ]
    );

    await client.query(
      `
      UPDATE units
      SET status = 'vacant'
      WHERE id = $1
        AND owner_id = $2
      `,
      [existing.unit_id, existing.owner_id]
    );

    await client.query(
      `
      UPDATE tenant_payment_identities
      SET status = 'inactive'
      WHERE tenant_id = $1
      `,
      [tenantId]
    );

    await client.query('COMMIT');

    await logAudit({
      userId: user.id,
      action: 'TENANT_MOVED_OUT',
      entityType: 'tenant',
      entityId: tenantId,
      metadata: {
        tenant_name: existing.full_name,
        unit_id: existing.unit_id,
        unit_number: existing.unit_number,
        deposit_refund: data.deposit_refund,
        reason: data.reason,
      },
      ipAddress,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createCaretakerUser(ownerUser, data, ipAddress) {
  if (ownerUser.role !== 'owner' && ownerUser.role !== 'admin') {
    throw new Error('Only owners can create caretaker users');
  }

  const normalizedPhone = normalizePhone(data.phone);

  if (!normalizedPhone) {
    throw new Error('A valid caretaker phone number is required');
  }

  const { first_name, last_name } = splitName(data.full_name);
  const ownerId = ownerUser.role === 'owner' ? ownerUser.id : data.owner_id;

  const result = await db.query(
    `
    INSERT INTO users (
      first_name,
      last_name,
      phone,
      role,
      status,
      owner_id,
      created_by
    )
    VALUES ($1, $2, $3, 'caretaker', 'active', $4, $5)
    ON CONFLICT (phone)
    DO UPDATE SET
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      role = 'caretaker',
      status = 'active',
      owner_id = EXCLUDED.owner_id,
      created_by = EXCLUDED.created_by
    RETURNING *
    `,
    [
      first_name,
      last_name || 'Caretaker',
      normalizedPhone,
      ownerId,
      ownerUser.id,
    ]
  );

  await logAudit({
    userId: ownerUser.id,
    action: 'CARETAKER_CREATED',
    entityType: 'user',
    entityId: result.rows[0].id,
    metadata: {
      phone: normalizedPhone,
      owner_id: ownerId,
    },
    ipAddress,
  });

  return result.rows[0];
}

module.exports = {
  listTenants,
  getTenantById,
  createTenant,
  updateTenant,
  moveOutTenant,
  createCaretakerUser,
};