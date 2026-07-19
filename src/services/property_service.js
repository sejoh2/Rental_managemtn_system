const db = require('../config/db');
const { logAudit } = require('./audit_service');

const typeLabels = {
  apartment_block: 'Apartment',
  bedsitters: 'Bedsitters',
  mixed_use: 'Mixed use',
  single_rooms: 'Single rooms',
};

function normalizeAccountType(type) {
  const map = {
    paybill: 'mpesa_paybill',
    till: 'mpesa_till',
    bank: 'bank_account',
    mpesa_paybill: 'mpesa_paybill',
    mpesa_till: 'mpesa_till',
    bank_account: 'bank_account',
    cash: 'cash',
    other: 'other',
  };

  return map[type] || 'other';
}

function formatMoneyShort(amount) {
  const value = Number(amount || 0);

  if (value >= 1000000) return `KES ${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `KES ${Math.round(value / 1000)}K`;

  return `KES ${value.toLocaleString('en-KE')}`;
}

function publicProperty(row) {
  return {
    id: Number(row.id),
    owner_id: Number(row.owner_id),
    name: row.name,
    location: row.location,
    property_type: row.property_type,
    type: typeLabels[row.property_type] || row.property_type,
    expected_units: Number(row.expected_units || 0),
    units: Number(row.units_count || row.expected_units || 0),
    occupied: Number(row.occupied_units || 0),
    collected: formatMoneyShort(row.collected_this_month),
    rent_due_day: row.rent_due_day,
    water_billing_method: row.water_billing_method,
    water_rate_per_unit: Number(row.water_rate_per_unit || 0),
    sms_sender_id: row.sms_sender_id,
    status: row.status,
    caretaker: row.caretaker_id
      ? {
          id: Number(row.caretaker_id),
          name: `${row.caretaker_first_name || ''} ${row.caretaker_last_name || ''}`.trim(),
          phone: row.caretaker_phone,
        }
      : null,
    payment_accounts: {
      rent: row.rent_account_id
        ? {
            id: Number(row.rent_account_id),
            account_type: row.rent_account_type,
            provider_name: row.rent_provider_name,
            business_number: row.rent_business_number,
            till_number: row.rent_till_number,
            account_number: row.rent_account_number,
            account_name: row.rent_account_name,
            label: row.rent_label,
          }
        : null,
      water: row.water_account_id
        ? {
            id: Number(row.water_account_id),
            account_type: row.water_account_type,
            provider_name: row.water_provider_name,
            business_number: row.water_business_number,
            till_number: row.water_till_number,
            account_number: row.water_account_number,
            account_name: row.water_account_name,
            label: row.water_label,
          }
        : null,
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function basePropertySelect(whereClause) {
  return `
    SELECT
      p.*,

      caretaker.first_name AS caretaker_first_name,
      caretaker.last_name AS caretaker_last_name,
      caretaker.phone AS caretaker_phone,

      rent_account.id AS rent_account_id,
      rent_account.account_type AS rent_account_type,
      rent_account.provider_name AS rent_provider_name,
      rent_account.business_number AS rent_business_number,
      rent_account.till_number AS rent_till_number,
      rent_account.account_number AS rent_account_number,
      rent_account.account_name AS rent_account_name,
      rent_account.label AS rent_label,

      water_account.id AS water_account_id,
      water_account.account_type AS water_account_type,
      water_account.provider_name AS water_provider_name,
      water_account.business_number AS water_business_number,
      water_account.till_number AS water_till_number,
      water_account.account_number AS water_account_number,
      water_account.account_name AS water_account_name,
      water_account.label AS water_label,

      0::INTEGER AS units_count,
      0::INTEGER AS occupied_units,
      0::NUMERIC AS collected_this_month

    FROM properties p
    LEFT JOIN users caretaker ON caretaker.id = p.caretaker_id
    LEFT JOIN payment_accounts rent_account
      ON rent_account.property_id = p.id
      AND rent_account.account_for = 'rent'
      AND rent_account.status = 'active'
    LEFT JOIN payment_accounts water_account
      ON water_account.property_id = p.id
      AND water_account.account_for = 'water'
      AND water_account.status = 'active'
    ${whereClause}
  `;
}

function getOwnerScope(user) {
  if (user.role === 'admin') return null;
  return user.id;
}

async function listProperties(user) {
  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        ${basePropertySelect('WHERE p.owner_id = $1 AND p.status = $2')}
        ORDER BY p.created_at DESC
        `,
        [ownerId, 'active']
      )
    : await db.query(
        `
        ${basePropertySelect('WHERE p.status = $1')}
        ORDER BY p.created_at DESC
        `,
        ['active']
      );

  return result.rows.map(publicProperty);
}

async function getPropertyById(user, propertyId) {
  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        ${basePropertySelect('WHERE p.id = $1 AND p.owner_id = $2')}
        LIMIT 1
        `,
        [propertyId, ownerId]
      )
    : await db.query(
        `
        ${basePropertySelect('WHERE p.id = $1')}
        LIMIT 1
        `,
        [propertyId]
      );

  return result.rows[0] ? publicProperty(result.rows[0]) : null;
}

async function validateCaretaker(ownerId, caretakerId) {
  if (!caretakerId) return null;

  const result = await db.query(
    `
    SELECT id
    FROM users
    WHERE id = $1
      AND role = 'caretaker'
      AND status = 'active'
      AND owner_id = $2
    `,
    [caretakerId, ownerId]
  );

  if (!result.rows[0]) {
    throw new Error('Selected caretaker does not belong to this owner');
  }

  return caretakerId;
}

function normalizePaymentAccount(account, accountFor) {
  if (!account) return null;

  const accountType = normalizeAccountType(account.account_type);
  const providerName = account.provider_name || account.bank_name || null;

  return {
    account_type: accountType,
    provider_name: providerName,
    business_number: account.business_number || null,
    till_number: account.till_number || null,
    account_number: account.account_number || account.raw_value || null,
    account_name: account.account_name || null,
    label: account.label || `${accountFor === 'rent' ? 'Rent' : 'Water'} account`,
  };
}

async function upsertPaymentAccount(client, { ownerId, propertyId, accountFor, account }) {
  const normalized = normalizePaymentAccount(account, accountFor);

  if (!normalized) return;

  const hasAnyValue =
    normalized.provider_name ||
    normalized.business_number ||
    normalized.till_number ||
    normalized.account_number ||
    normalized.account_name ||
    normalized.label;

  if (!hasAnyValue) return;

  await client.query(
    `
    UPDATE payment_accounts
    SET status = 'inactive'
    WHERE property_id = $1
      AND account_for = $2
      AND status = 'active'
    `,
    [propertyId, accountFor]
  );

  await client.query(
    `
    INSERT INTO payment_accounts (
      owner_id,
      property_id,
      account_for,
      account_type,
      provider_name,
      business_number,
      till_number,
      account_number,
      account_name,
      label
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
    [
      ownerId,
      propertyId,
      accountFor,
      normalized.account_type,
      normalized.provider_name,
      normalized.business_number,
      normalized.till_number,
      normalized.account_number,
      normalized.account_name,
      normalized.label,
    ]
  );
}

async function createProperty(user, data, ipAddress) {
  if (user.role !== 'owner' && user.role !== 'admin') {
    throw new Error('Only owners can create properties');
  }

  const ownerId = user.id;
  const caretakerId = await validateCaretaker(ownerId, data.caretaker_id);
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const propertyResult = await client.query(
      `
      INSERT INTO properties (
        owner_id,
        caretaker_id,
        name,
        location,
        property_type,
        expected_units,
        rent_due_day,
        water_billing_method,
        water_rate_per_unit,
        sms_sender_id,
        created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
      `,
      [
        ownerId,
        caretakerId,
        data.name,
        data.location,
        data.property_type,
        data.expected_units || 0,
        data.rent_due_day || '5th of every month',
        data.water_billing_method || 'per_unit_metered',
        data.water_rate_per_unit || 0,
        data.sms_sender_id || null,
        user.id,
      ]
    );

    const property = propertyResult.rows[0];

    await upsertPaymentAccount(client, {
      ownerId,
      propertyId: property.id,
      accountFor: 'rent',
      account: data.rent_account,
    });

    await upsertPaymentAccount(client, {
      ownerId,
      propertyId: property.id,
      accountFor: 'water',
      account: data.water_account,
    });

    await client.query('COMMIT');

    await logAudit({
      userId: user.id,
      action: 'PROPERTY_CREATED',
      entityType: 'property',
      entityId: property.id,
      metadata: { name: property.name, owner_id: ownerId },
      ipAddress,
    });

    return getPropertyById(user, property.id);
  } catch (error) {
    await client.query('ROLLBACK');

    if (error.code === '23505') {
      throw new Error('A property with this name already exists for this owner');
    }

    throw error;
  } finally {
    client.release();
  }
}

async function updateProperty(user, propertyId, data, ipAddress) {
  const existing = await getPropertyById(user, propertyId);

  if (!existing) {
    throw new Error('Property not found');
  }

  const ownerId = existing.owner_id;
  const caretakerId =
    Object.prototype.hasOwnProperty.call(data, 'caretaker_id')
      ? await validateCaretaker(ownerId, data.caretaker_id)
      : existing.caretaker?.id || null;

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    await client.query(
      `
      UPDATE properties
      SET
        caretaker_id = $1,
        name = COALESCE($2, name),
        location = COALESCE($3, location),
        property_type = COALESCE($4, property_type),
        expected_units = COALESCE($5, expected_units),
        rent_due_day = COALESCE($6, rent_due_day),
        water_billing_method = COALESCE($7, water_billing_method),
        water_rate_per_unit = COALESCE($8, water_rate_per_unit),
        sms_sender_id = COALESCE($9, sms_sender_id)
      WHERE id = $10
        AND owner_id = $11
      RETURNING *
      `,
      [
        caretakerId,
        data.name || null,
        data.location || null,
        data.property_type || null,
        data.expected_units ?? null,
        data.rent_due_day || null,
        data.water_billing_method || null,
        data.water_rate_per_unit ?? null,
        data.sms_sender_id || null,
        propertyId,
        ownerId,
      ]
    );

    if (Object.prototype.hasOwnProperty.call(data, 'rent_account')) {
      await upsertPaymentAccount(client, {
        ownerId,
        propertyId,
        accountFor: 'rent',
        account: data.rent_account,
      });
    }

    if (Object.prototype.hasOwnProperty.call(data, 'water_account')) {
      await upsertPaymentAccount(client, {
        ownerId,
        propertyId,
        accountFor: 'water',
        account: data.water_account,
      });
    }

    await client.query('COMMIT');

    await logAudit({
      userId: user.id,
      action: 'PROPERTY_UPDATED',
      entityType: 'property',
      entityId: propertyId,
      metadata: data,
      ipAddress,
    });

    return getPropertyById(user, propertyId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function archiveProperty(user, propertyId, ipAddress) {
  const existing = await getPropertyById(user, propertyId);

  if (!existing) {
    throw new Error('Property not found');
  }

  await db.query(
    `
    UPDATE properties
    SET status = 'archived',
        archived_at = CURRENT_TIMESTAMP
    WHERE id = $1
      AND owner_id = $2
    `,
    [propertyId, existing.owner_id]
  );

  await logAudit({
    userId: user.id,
    action: 'PROPERTY_ARCHIVED',
    entityType: 'property',
    entityId: propertyId,
    metadata: { name: existing.name },
    ipAddress,
  });
}

module.exports = {
  listProperties,
  getPropertyById,
  createProperty,
  updateProperty,
  archiveProperty,
};