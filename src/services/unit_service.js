const db = require('../config/db');
const { logAudit } = require('./audit_service');

const unitTypeLabels = {
  single_room: 'Single room',
  bedsitter: 'Bedsitter',
  one_bedroom: 'One bedroom',
  two_bedroom: 'Two bedroom',
  three_bedroom: 'Three bedroom',
  shop: 'Shop',
  other: 'Other',
};

const statusLabels = {
  vacant: 'Vacant',
  occupied: 'Occupied',
  maintenance: 'Under maintenance',
  archived: 'Archived',
};

function formatMoney(amount) {
  return `KES ${Number(amount || 0).toLocaleString('en-KE')}`;
}

function publicUnit(row) {
  const hasArrears = Number(row.balance_amount || 0) > 0;

  return {
    id: Number(row.id),
    owner_id: Number(row.owner_id),
    property_id: Number(row.property_id),
    property_name: row.property_name,
    unit_number: row.unit_number,
    house_number: row.unit_number,
    floor: row.floor,
    floor_label: row.floor ? `Floor ${row.floor}` : null,
    unit_type: row.unit_type,
    unit_type_label: unitTypeLabels[row.unit_type] || row.unit_type,
    monthly_rent: Number(row.monthly_rent || 0),
    monthly_rent_display: formatMoney(row.monthly_rent),
    deposit_amount: Number(row.deposit_amount || 0),
    deposit_display: formatMoney(row.deposit_amount),
    water_meter_number: row.water_meter_number,
    status: row.status,
    status_label: statusLabels[row.status] || row.status,
    has_arrears: hasArrears,
    balance_amount: Number(row.balance_amount || 0),
    balance_display: formatMoney(row.balance_amount || 0),
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function baseUnitsSelect(whereClause = '') {
  return `
    SELECT
      u.*,
      p.name AS property_name,
      0::NUMERIC AS balance_amount
    FROM units u
    INNER JOIN properties p ON p.id = u.property_id
    ${whereClause}
  `;
}

function getOwnerScope(user) {
  if (user.role === 'admin') return null;
  if (user.role === 'caretaker') return user.owner_id;
  return user.id;
}

function assertCaretakerCanUpdate(data) {
  const allowedFields = ['status', 'notes'];
  const receivedFields = Object.keys(data);

  const blockedField = receivedFields.find((field) => !allowedFields.includes(field));

  if (blockedField) {
    throw new Error('Caretakers can only update unit status and notes');
  }
}

function normalizeStatusFilter(status) {
  if (!status || status === 'all') return null;
  if (status === 'under_maintenance') return 'maintenance';
  if (status === 'in_arrears') return 'in_arrears';
  return status;
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

async function listUnits(user, filters = {}) {
  const ownerId = getOwnerScope(user);
  const status = normalizeStatusFilter(filters.status);

  const conditions = [`u.status != 'archived'`];
  const params = [];

  if (ownerId) {
    params.push(ownerId);
    conditions.push(`u.owner_id = $${params.length}`);
  }

  if (filters.property_id) {
    await assertPropertyAccess(user, filters.property_id);

    params.push(filters.property_id);
    conditions.push(`u.property_id = $${params.length}`);
  }

  if (status && status !== 'in_arrears') {
    params.push(status);
    conditions.push(`u.status = $${params.length}`);
  }

  const result = await db.query(
    `
    ${baseUnitsSelect(`WHERE ${conditions.join(' AND ')}`)}
    ORDER BY p.name ASC, u.unit_number ASC
    `,
    params
  );

  let units = result.rows.map(publicUnit);

  if (status === 'in_arrears') {
    units = units.filter((unit) => unit.has_arrears);
  }

  return {
    units,
    summary: buildUnitSummary(units),
  };
}

function buildUnitSummary(units) {
  return {
    all: units.length,
    occupied: units.filter((unit) => unit.status === 'occupied').length,
    vacant: units.filter((unit) => unit.status === 'vacant').length,
    maintenance: units.filter((unit) => unit.status === 'maintenance').length,
    in_arrears: units.filter((unit) => unit.has_arrears).length,
  };
}

async function getUnitById(user, unitId) {
  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        ${baseUnitsSelect('WHERE u.id = $1 AND u.owner_id = $2')}
        LIMIT 1
        `,
        [unitId, ownerId]
      )
    : await db.query(
        `
        ${baseUnitsSelect('WHERE u.id = $1')}
        LIMIT 1
        `,
        [unitId]
      );

  return result.rows[0] ? publicUnit(result.rows[0]) : null;
}

async function createUnit(user, data, ipAddress) {
  if (user.role !== 'owner' && user.role !== 'admin') {
    throw new Error('Only owners can create units');
  }

  const property = await assertPropertyAccess(user, data.property_id);

  const result = await db.query(
    `
    INSERT INTO units (
      owner_id,
      property_id,
      unit_number,
      floor,
      unit_type,
      monthly_rent,
      deposit_amount,
      water_meter_number,
      status,
      notes,
      created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *
    `,
    [
      property.owner_id,
      data.property_id,
      data.unit_number,
      data.floor || null,
      data.unit_type,
      data.monthly_rent || 0,
      data.deposit_amount || 0,
      data.water_meter_number || null,
      data.status || 'vacant',
      data.notes || null,
      user.id,
    ]
  );

  await logAudit({
    userId: user.id,
    action: 'UNIT_CREATED',
    entityType: 'unit',
    entityId: result.rows[0].id,
    metadata: {
      property_id: data.property_id,
      property_name: property.name,
      unit_number: data.unit_number,
    },
    ipAddress,
  });

  return getUnitById(user, result.rows[0].id);
}

async function updateUnit(user, unitId, data, ipAddress) {
    if (user.role === 'caretaker') {
  assertCaretakerCanUpdate(data);
 }
  const existing = await getUnitById(user, unitId);

  if (!existing) {
    throw new Error('Unit not found');
  }

  const result = await db.query(
    `
    UPDATE units
    SET
      unit_number = COALESCE($1, unit_number),
      floor = COALESCE($2, floor),
      unit_type = COALESCE($3, unit_type),
      monthly_rent = COALESCE($4, monthly_rent),
      deposit_amount = COALESCE($5, deposit_amount),
      water_meter_number = COALESCE($6, water_meter_number),
      status = COALESCE($7, status),
      notes = COALESCE($8, notes)
    WHERE id = $9
      AND owner_id = $10
    RETURNING *
    `,
    [
      data.unit_number || null,
      data.floor || null,
      data.unit_type || null,
      data.monthly_rent ?? null,
      data.deposit_amount ?? null,
      data.water_meter_number || null,
      data.status || null,
      data.notes || null,
      unitId,
      existing.owner_id,
    ]
  );

  if (!result.rows[0]) {
    throw new Error('Unit not found');
  }

  await logAudit({
    userId: user.id,
    action: 'UNIT_UPDATED',
    entityType: 'unit',
    entityId: unitId,
    metadata: data,
    ipAddress,
  });

  return getUnitById(user, unitId);
}

async function archiveUnit(user, unitId, ipAddress) {
  const existing = await getUnitById(user, unitId);

  if (!existing) {
    throw new Error('Unit not found');
  }

  if (existing.status === 'occupied') {
    throw new Error('Cannot archive an occupied unit. Move out the tenant first.');
  }

  await db.query(
    `
    UPDATE units
    SET status = 'archived',
        archived_at = CURRENT_TIMESTAMP
    WHERE id = $1
      AND owner_id = $2
    `,
    [unitId, existing.owner_id]
  );

  await logAudit({
    userId: user.id,
    action: 'UNIT_ARCHIVED',
    entityType: 'unit',
    entityId: unitId,
    metadata: {
      property_id: existing.property_id,
      unit_number: existing.unit_number,
    },
    ipAddress,
  });
}

module.exports = {
  listUnits,
  getUnitById,
  createUnit,
  updateUnit,
  archiveUnit,
};