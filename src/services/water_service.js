const db = require('../config/db');
const { logAudit } = require('./audit_service');

function formatMoney(amount) {
  return `KES ${Number(amount || 0).toLocaleString('en-KE')}`;
}

function getOwnerScope(user) {
  if (user.role === 'admin') return null;
  if (user.role === 'caretaker') return user.owner_id;
  return user.id;
}

function publicReading(row) {
  return {
    id: Number(row.id),
    owner_id: Number(row.owner_id),
    property_id: Number(row.property_id),
    property_name: row.property_name,
    unit_id: Number(row.unit_id),
    unit_number: row.unit_number,
    tenant_id: row.tenant_id ? Number(row.tenant_id) : null,
    tenant_name: row.tenant_name,
    meter_number: row.meter_number,
    previous_reading: Number(row.previous_reading || 0),
    current_reading: Number(row.current_reading || 0),
    units_used: Number(row.units_used || 0),
    reading_date: row.reading_date,
    submitted_by: row.submitted_by ? Number(row.submitted_by) : null,
    submitted_by_name: row.submitted_by_name,
    submitted_by_role: row.submitted_by_role,
    photo_url: row.photo_url,
    notes: row.notes,
    status: row.status,
    flagged: row.flagged,
    flag_reason: row.flag_reason,
    created_at: row.created_at,
  };
}

function publicBill(row) {
  return {
    id: Number(row.id),
    owner_id: Number(row.owner_id),
    property_id: Number(row.property_id),
    property_name: row.property_name,
    unit_id: Number(row.unit_id),
    unit_number: row.unit_number,
    tenant_id: Number(row.tenant_id),
    tenant_name: row.tenant_name,
    reading_id: row.reading_id ? Number(row.reading_id) : null,
    billing_month: row.billing_month,
    units_consumed: Number(row.units_consumed || 0),
    rate_per_unit: Number(row.rate_per_unit || 0),
    total_amount: Number(row.total_amount || 0),
    total_amount_display: formatMoney(row.total_amount || 0),
    amount_paid: Number(row.amount_paid || 0),
    amount_paid_display: formatMoney(row.amount_paid || 0),
    balance: Number(row.balance || 0),
    balance_display: formatMoney(row.balance || 0),
    status: row.status,
    due_date: row.due_date,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

async function assertUnitAccess(user, unitId) {
  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        SELECT u.*, p.name AS property_name, p.water_rate_per_unit, p.water_billing_method
        FROM units u
        INNER JOIN properties p ON p.id = u.property_id
        WHERE u.id = $1
          AND u.owner_id = $2
          AND u.status != 'archived'
        `,
        [unitId, ownerId]
      )
    : await db.query(
        `
        SELECT u.*, p.name AS property_name, p.water_rate_per_unit, p.water_billing_method
        FROM units u
        INNER JOIN properties p ON p.id = u.property_id
        WHERE u.id = $1
          AND u.status != 'archived'
        `,
        [unitId]
      );

  if (!result.rows[0]) {
    throw new Error('Unit not found or you do not have access to it');
  }

  return result.rows[0];
}

// ============================================================
// METER READING FUNCTIONS
// ============================================================

async function submitMeterReading(user, data, ipAddress) {
  if (!['admin', 'owner', 'caretaker'].includes(user.role)) {
    throw new Error('You are not allowed to submit meter readings');
  }

  const ownerId = getOwnerScope(user);
  
  // If caretaker, verify they have access to this unit's property
  if (user.role === 'caretaker') {
    const propertyCheck = await db.query(
      `
      SELECT id FROM properties
      WHERE id = (
        SELECT property_id FROM units WHERE id = $1
      )
      AND caretaker_id = $2
      AND status = 'active'
      `,
      [data.unit_id, user.id]
    );
    
    if (!propertyCheck.rows[0]) {
      throw new Error('You do not have access to this unit\'s property');
    }
  }

  const unit = await assertUnitAccess(user, data.unit_id);

  // Get the last reading for this unit
  const lastReading = await db.query(
    `
    SELECT current_reading
    FROM water_meter_readings
    WHERE unit_id = $1
      AND status != 'rejected'
    ORDER BY reading_date DESC, created_at DESC
    LIMIT 1
    `,
    [data.unit_id]
  );

  const previousReading = lastReading.rows[0] ? Number(lastReading.rows[0].current_reading) : 0;
  const currentReading = Number(data.current_reading);
  const unitsUsed = currentReading - previousReading;

  // Check for suspicious reading (lower than previous)
  let flagged = false;
  let flagReason = null;

  if (currentReading < previousReading) {
    flagged = true;
    flagReason = `Reading decreased from ${previousReading} to ${currentReading}`;
  }

  // Check for unusually high consumption (more than 3x average)
  const avgResult = await db.query(
    `
    SELECT AVG(units_used) AS avg_units
    FROM water_meter_readings
    WHERE unit_id = $1
      AND status != 'rejected'
      AND status != 'pending'
    ORDER BY reading_date DESC
    LIMIT 3
    `,
    [data.unit_id]
  );

  if (avgResult.rows[0]?.avg_units) {
    const avgUnits = Number(avgResult.rows[0].avg_units);
    if (avgUnits > 0 && unitsUsed > avgUnits * 3) {
      flagged = true;
      flagReason = flagReason 
        ? `${flagReason} | Unusually high consumption: ${unitsUsed} units vs avg ${Math.round(avgUnits)} units`
        : `Unusually high consumption: ${unitsUsed} units vs avg ${Math.round(avgUnits)} units`;
    }
  }

  // Get tenant for this unit
  const tenantResult = await db.query(
    `
    SELECT id, full_name
    FROM tenants
    WHERE unit_id = $1
      AND status = 'active'
    LIMIT 1
    `,
    [data.unit_id]
  );

  const tenantId = tenantResult.rows[0]?.id || null;

  const result = await db.query(
    `
    INSERT INTO water_meter_readings (
      owner_id,
      property_id,
      unit_id,
      tenant_id,
      meter_number,
      previous_reading,
      current_reading,
      units_used,
      reading_date,
      submitted_by,
      photo_url,
      notes,
      status,
      flagged,
      flag_reason
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::DATE, CURRENT_DATE), $10, $11, $12, 'pending', $13, $14)
    RETURNING *
    `,
    [
      ownerId || unit.owner_id,
      unit.property_id,
      data.unit_id,
      tenantId,
      data.meter_number || unit.water_meter_number,
      previousReading,
      currentReading,
      unitsUsed,
      data.reading_date || null,
      user.id,
      data.photo_url || null,
      data.notes || null,
      flagged,
      flagReason,
    ]
  );

  await logAudit({
    userId: user.id,
    action: 'WATER_READING_SUBMITTED',
    entityType: 'water_meter_reading',
    entityId: result.rows[0].id,
    metadata: {
      unit_id: data.unit_id,
      unit_number: unit.unit_number,
      previous_reading: previousReading,
      current_reading: currentReading,
      units_used: unitsUsed,
      flagged: flagged,
      submitted_by_role: user.role,
    },
    ipAddress,
  });

  return publicReading(result.rows[0]);
}

async function getPendingReadings(user) {
  if (!['admin', 'owner'].includes(user.role)) {
    throw new Error('Only owners can view pending readings');
  }

  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        SELECT
          r.*,
          p.name AS property_name,
          u.unit_number,
          t.full_name AS tenant_name,
          CONCAT(sub.first_name, ' ', sub.last_name) AS submitted_by_name,
          sub.role AS submitted_by_role
        FROM water_meter_readings r
        INNER JOIN properties p ON p.id = r.property_id
        INNER JOIN units u ON u.id = r.unit_id
        LEFT JOIN tenants t ON t.id = r.tenant_id
        LEFT JOIN users sub ON sub.id = r.submitted_by
        WHERE r.owner_id = $1
          AND r.status = 'pending'
        ORDER BY r.reading_date DESC, r.created_at DESC
        `,
        [ownerId]
      )
    : await db.query(
        `
        SELECT
          r.*,
          p.name AS property_name,
          u.unit_number,
          t.full_name AS tenant_name,
          CONCAT(sub.first_name, ' ', sub.last_name) AS submitted_by_name,
          sub.role AS submitted_by_role
        FROM water_meter_readings r
        INNER JOIN properties p ON p.id = r.property_id
        INNER JOIN units u ON u.id = r.unit_id
        LEFT JOIN tenants t ON t.id = r.tenant_id
        LEFT JOIN users sub ON sub.id = r.submitted_by
        WHERE r.status = 'pending'
        ORDER BY r.reading_date DESC, r.created_at DESC
        `
      );

  return result.rows.map(publicReading);
}

async function approveReading(user, readingId, data, ipAddress) {
  if (!['admin', 'owner'].includes(user.role)) {
    throw new Error('Only owners can approve readings');
  }

  const ownerId = getOwnerScope(user);

  const readingResult = ownerId
    ? await db.query(
        `
        SELECT r.*
        FROM water_meter_readings r
        WHERE r.id = $1
          AND r.owner_id = $2
          AND r.status = 'pending'
        `,
        [readingId, ownerId]
      )
    : await db.query(
        `
        SELECT r.*
        FROM water_meter_readings r
        WHERE r.id = $1
          AND r.status = 'pending'
        `,
        [readingId]
      );

  if (!readingResult.rows[0]) {
    throw new Error('Pending reading not found');
  }

  const reading = readingResult.rows[0];

  if (data.status === 'rejected') {
    await db.query(
      `
      UPDATE water_meter_readings
      SET status = 'rejected',
          notes = COALESCE($1, notes)
      WHERE id = $2
      `,
      [data.notes || null, readingId]
    );

    await logAudit({
      userId: user.id,
      action: 'WATER_READING_REJECTED',
      entityType: 'water_meter_reading',
      entityId: readingId,
      metadata: {
        unit_id: reading.unit_id,
        notes: data.notes,
      },
      ipAddress,
    });

    return { success: true, message: 'Reading rejected' };
  }

  // Approve the reading
  await db.query(
    `
    UPDATE water_meter_readings
    SET status = 'approved',
        notes = COALESCE($1, notes)
    WHERE id = $2
    `,
    [data.notes || null, readingId]
  );

  // Generate water bill from this reading
  const bill = await generateBillFromReading(user, readingId, ipAddress);

  await logAudit({
    userId: user.id,
    action: 'WATER_READING_APPROVED',
    entityType: 'water_meter_reading',
    entityId: readingId,
    metadata: {
      unit_id: reading.unit_id,
      bill_id: bill.id,
    },
    ipAddress,
  });

  return { success: true, message: 'Reading approved and bill generated', bill };
}

async function generateBillFromReading(user, readingId, ipAddress) {
  const reading = await db.query(
    `
    SELECT r.*, p.water_rate_per_unit, p.water_billing_method, p.water_fixed_fee
    FROM water_meter_readings r
    INNER JOIN properties p ON p.id = r.property_id
    WHERE r.id = $1
    `,
    [readingId]
  );

  if (!reading.rows[0]) {
    throw new Error('Reading not found');
  }

  const data = reading.rows[0];

  // Calculate bill amount based on billing method
  let totalAmount = 0;
  const units = Number(data.units_used || 0);

  if (data.water_billing_method === 'included_in_rent') {
    totalAmount = 0; // Included in rent - no separate bill
  } else if (data.water_billing_method === 'fixed_monthly') {
    totalAmount = Number(data.water_fixed_fee || 0);
  } else {
    // Per-unit metered (default)
    const rate = Number(data.water_rate_per_unit || 0);
    totalAmount = rate * units;
  }

  // Get the tenant
  const tenantResult = await db.query(
    `
    SELECT id, full_name
    FROM tenants
    WHERE unit_id = $1 AND status = 'active'
    LIMIT 1
    `,
    [data.unit_id]
  );

  const tenantId = tenantResult.rows[0]?.id || null;

  // Calculate due date (30 days from billing month)
  const billingDate = new Date(data.reading_date);
  const dueDate = new Date(billingDate);
  dueDate.setDate(dueDate.getDate() + 30);

  // Create the bill
  const billResult = await db.query(
    `
    INSERT INTO water_bills (
      owner_id,
      property_id,
      unit_id,
      tenant_id,
      reading_id,
      billing_month,
      units_consumed,
      rate_per_unit,
      total_amount,
      amount_paid,
      balance,
      status,
      due_date
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10, 'unpaid', $11)
    RETURNING *
    `,
    [
      data.owner_id,
      data.property_id,
      data.unit_id,
      tenantId,
      data.id,
      billingDate,
      units,
      Number(data.water_rate_per_unit || 0),
      totalAmount,
      totalAmount,
      dueDate,
    ]
  );

  // Update reading status to billed
  await db.query(
    `
    UPDATE water_meter_readings
    SET status = 'billed'
    WHERE id = $1
    `,
    [data.id]
  );

  await logAudit({
    userId: user.id,
    action: 'WATER_BILL_GENERATED',
    entityType: 'water_bill',
    entityId: billResult.rows[0].id,
    metadata: {
      reading_id: data.id,
      unit_id: data.unit_id,
      units: units,
      amount: totalAmount,
      billing_method: data.water_billing_method,
    },
    ipAddress,
  });

  return publicBill(billResult.rows[0]);
}

// ============================================================
// WATER BILL FUNCTIONS
// ============================================================

async function getTenantWaterBills(user, tenantId) {
  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        SELECT
          b.*,
          p.name AS property_name,
          u.unit_number,
          t.full_name AS tenant_name
        FROM water_bills b
        INNER JOIN properties p ON p.id = b.property_id
        INNER JOIN units u ON u.id = b.unit_id
        INNER JOIN tenants t ON t.id = b.tenant_id
        WHERE b.tenant_id = $1
          AND b.owner_id = $2
        ORDER BY b.billing_month DESC
        `,
        [tenantId, ownerId]
      )
    : await db.query(
        `
        SELECT
          b.*,
          p.name AS property_name,
          u.unit_number,
          t.full_name AS tenant_name
        FROM water_bills b
        INNER JOIN properties p ON p.id = b.property_id
        INNER JOIN units u ON u.id = b.unit_id
        INNER JOIN tenants t ON t.id = b.tenant_id
        WHERE b.tenant_id = $1
        ORDER BY b.billing_month DESC
        `,
        [tenantId]
      );

  return result.rows.map(publicBill);
}

async function getUnitWaterBills(user, unitId) {
  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        SELECT
          b.*,
          p.name AS property_name,
          u.unit_number,
          t.full_name AS tenant_name
        FROM water_bills b
        INNER JOIN properties p ON p.id = b.property_id
        INNER JOIN units u ON u.id = b.unit_id
        LEFT JOIN tenants t ON t.id = b.tenant_id
        WHERE b.unit_id = $1
          AND b.owner_id = $2
        ORDER BY b.billing_month DESC
        `,
        [unitId, ownerId]
      )
    : await db.query(
        `
        SELECT
          b.*,
          p.name AS property_name,
          u.unit_number,
          t.full_name AS tenant_name
        FROM water_bills b
        INNER JOIN properties p ON p.id = b.property_id
        INNER JOIN units u ON u.id = b.unit_id
        LEFT JOIN tenants t ON t.id = b.tenant_id
        WHERE b.unit_id = $1
        ORDER BY b.billing_month DESC
        `,
        [unitId]
      );

  return result.rows.map(publicBill);
}

// ============================================================
// WATER RULES FUNCTIONS
// ============================================================

async function getWaterRules(user, propertyId) {
  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        SELECT 
          water_billing_method,
          water_rate_per_unit,
          water_fixed_fee,
          water_billing_day,
          water_reading_due_days,
          water_missed_reading_action
        FROM properties
        WHERE id = $1
          AND owner_id = $2
          AND status = 'active'
        `,
        [propertyId, ownerId]
      )
    : await db.query(
        `
        SELECT 
          water_billing_method,
          water_rate_per_unit,
          water_fixed_fee,
          water_billing_day,
          water_reading_due_days,
          water_missed_reading_action
        FROM properties
        WHERE id = $1
          AND status = 'active'
        `,
        [propertyId]
      );

  if (!result.rows[0]) {
    throw new Error('Property not found');
  }

  const rules = result.rows[0];
  
  const methodLabels = {
    per_unit_metered: 'Per-unit metered',
    fixed_monthly: 'Fixed monthly fee',
    included_in_rent: 'Included in rent',
  };

  const actionLabels = {
    carry_forward: 'Carry forward previous month\'s units and flag for review',
    do_not_bill: 'Do not bill until reading is submitted',
    estimate_average: 'Estimate based on average of last 3 months',
  };

  return {
    billing_method: rules.water_billing_method,
    billing_method_label: methodLabels[rules.water_billing_method] || rules.water_billing_method,
    rate_per_unit: Number(rules.water_rate_per_unit || 0),
    fixed_fee: Number(rules.water_fixed_fee || 0),
    billing_day: rules.water_billing_day || 'same_as_rent',
    reading_due_days: Number(rules.water_reading_due_days || 3),
    missed_reading_action: rules.water_missed_reading_action,
    missed_reading_action_label: actionLabels[rules.water_missed_reading_action] || rules.water_missed_reading_action,
  };
}

async function updateWaterRules(user, propertyId, data, ipAddress) {
  if (!['admin', 'owner'].includes(user.role)) {
    throw new Error('Only owners can update water rules');
  }

  const ownerId = getOwnerScope(user);

  // Verify property exists
  const propertyResult = ownerId
    ? await db.query(
        `
        SELECT id, name
        FROM properties
        WHERE id = $1
          AND owner_id = $2
          AND status = 'active'
        `,
        [propertyId, ownerId]
      )
    : await db.query(
        `
        SELECT id, name
        FROM properties
        WHERE id = $1
          AND status = 'active'
        `,
        [propertyId]
      );

  if (!propertyResult.rows[0]) {
    throw new Error('Property not found');
  }

  const property = propertyResult.rows[0];

  // Build update query dynamically
  const updates = [];
  const values = [];
  let paramCount = 1;

  if (data.water_billing_method !== undefined) {
    updates.push(`water_billing_method = $${paramCount++}`);
    values.push(data.water_billing_method);
  }

  if (data.water_rate_per_unit !== undefined) {
    updates.push(`water_rate_per_unit = $${paramCount++}`);
    values.push(data.water_rate_per_unit);
  }

  if (data.water_fixed_fee !== undefined) {
    updates.push(`water_fixed_fee = $${paramCount++}`);
    values.push(data.water_fixed_fee);
  }

  if (data.water_billing_day !== undefined) {
    updates.push(`water_billing_day = $${paramCount++}`);
    values.push(data.water_billing_day);
  }

  if (data.water_reading_due_days !== undefined) {
    updates.push(`water_reading_due_days = $${paramCount++}`);
    values.push(data.water_reading_due_days);
  }

  if (data.water_missed_reading_action !== undefined) {
    updates.push(`water_missed_reading_action = $${paramCount++}`);
    values.push(data.water_missed_reading_action);
  }

  if (updates.length === 0) {
    throw new Error('No fields to update');
  }

  values.push(propertyId);
  values.push(ownerId || property.owner_id);

  await db.query(
    `
    UPDATE properties
    SET ${updates.join(', ')}
    WHERE id = $${paramCount++}
      AND owner_id = $${paramCount}
    `,
    values
  );

  await logAudit({
    userId: user.id,
    action: 'WATER_RULES_UPDATED',
    entityType: 'property',
    entityId: propertyId,
    metadata: {
      property_name: property.name,
      updates: data,
    },
    ipAddress,
  });

  return getWaterRules(user, propertyId);
}

async function getAllWaterRules(user) {
  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        SELECT 
          id,
          name,
          water_billing_method,
          water_rate_per_unit,
          water_fixed_fee,
          water_billing_day,
          water_reading_due_days,
          water_missed_reading_action
        FROM properties
        WHERE owner_id = $1
          AND status = 'active'
        ORDER BY name
        `,
        [ownerId]
      )
    : await db.query(
        `
        SELECT 
          id,
          name,
          water_billing_method,
          water_rate_per_unit,
          water_fixed_fee,
          water_billing_day,
          water_reading_due_days,
          water_missed_reading_action
        FROM properties
        WHERE status = 'active'
        ORDER BY name
        `
      );

  return result.rows.map((row) => {
    const methodLabels = {
      per_unit_metered: 'Per-unit metered',
      fixed_monthly: 'Fixed monthly fee',
      included_in_rent: 'Included in rent',
    };

    return {
      property_id: Number(row.id),
      property_name: row.name,
      billing_method: row.water_billing_method,
      billing_method_label: methodLabels[row.water_billing_method] || row.water_billing_method,
      rate_per_unit: Number(row.water_rate_per_unit || 0),
      fixed_fee: Number(row.water_fixed_fee || 0),
      billing_day: row.water_billing_day || 'same_as_rent',
      reading_due_days: Number(row.water_reading_due_days || 3),
      missed_reading_action: row.water_missed_reading_action,
    };
  });
}

// ============================================================
// STATS FUNCTIONS
// ============================================================

async function getWaterStats(user) {
  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        SELECT
          COUNT(*) AS total_readings,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_readings,
          SUM(CASE WHEN flagged = true THEN 1 ELSE 0 END) AS flagged_readings,
          (
            SELECT COALESCE(SUM(total_amount), 0)
            FROM water_bills
            WHERE owner_id = $1
              AND status != 'cancelled'
          ) AS total_billed,
          (
            SELECT COALESCE(SUM(amount_paid), 0)
            FROM water_bills
            WHERE owner_id = $1
              AND status != 'cancelled'
          ) AS total_collected,
          (
            SELECT COALESCE(SUM(balance), 0)
            FROM water_bills
            WHERE owner_id = $1
              AND status != 'cancelled'
              AND status != 'paid'
          ) AS total_outstanding
        FROM water_meter_readings
        WHERE owner_id = $1
        `,
        [ownerId]
      )
    : await db.query(
        `
        SELECT
          COUNT(*) AS total_readings,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_readings,
          SUM(CASE WHEN flagged = true THEN 1 ELSE 0 END) AS flagged_readings,
          (
            SELECT COALESCE(SUM(total_amount), 0)
            FROM water_bills
            WHERE status != 'cancelled'
          ) AS total_billed,
          (
            SELECT COALESCE(SUM(amount_paid), 0)
            FROM water_bills
            WHERE status != 'cancelled'
          ) AS total_collected,
          (
            SELECT COALESCE(SUM(balance), 0)
            FROM water_bills
            WHERE status != 'cancelled'
              AND status != 'paid'
          ) AS total_outstanding
        FROM water_meter_readings
        `
      );

  const stats = result.rows[0];
  return {
    total_readings: Number(stats.total_readings || 0),
    pending_readings: Number(stats.pending_readings || 0),
    flagged_readings: Number(stats.flagged_readings || 0),
    total_billed: Number(stats.total_billed || 0),
    total_billed_display: formatMoney(stats.total_billed || 0),
    total_collected: Number(stats.total_collected || 0),
    total_collected_display: formatMoney(stats.total_collected || 0),
    total_outstanding: Number(stats.total_outstanding || 0),
    total_outstanding_display: formatMoney(stats.total_outstanding || 0),
  };
}

module.exports = {
  submitMeterReading,
  getPendingReadings,
  approveReading,
  generateBillFromReading,
  getTenantWaterBills,
  getUnitWaterBills,
  getWaterRules,
  updateWaterRules,
  getAllWaterRules,
  getWaterStats,
  publicBill,
  publicReading,
};