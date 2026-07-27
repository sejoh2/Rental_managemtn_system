const db = require('../config/db');
const { normalizePhone } = require('../utils/phone');
const { logAudit } = require('./audit_service');

const DEFAULT_WATER_DEPOSIT = Number(process.env.DEFAULT_WATER_DEPOSIT_AMOUNT) || 2000;

function formatMoney(amount) {
  return `KES ${Number(amount || 0).toLocaleString('en-KE')}`;
}

function getOwnerScope(user) {
  if (user.role === 'admin') return null;
  if (user.role === 'caretaker') return user.owner_id;
  return user.id;
}

function getApplyToLabel(applyTo) {
  const labels = {
    rent_balance: 'Rent balance',
    water_bill: 'Water bill',
    rent_deposit: 'Rent deposit',
    electricity_deposit: 'Electricity deposit',
    water_deposit: 'Water deposit',
  };
  return labels[applyTo] || applyTo;
}

function getStatusLabel(status) {
  const labels = {
    matched: 'Matched',
    unmatched: 'Unmatched',
    reversed: 'Reversed',
  };
  return labels[status] || status;
}

function publicPayment(row) {
  return {
    id: Number(row.id),
    owner_id: Number(row.owner_id),
    property_id: row.property_id ? Number(row.property_id) : null,
    property_name: row.property_name,
    unit_id: row.unit_id ? Number(row.unit_id) : null,
    unit_number: row.unit_number,
    tenant_id: row.tenant_id ? Number(row.tenant_id) : null,
    tenant_name: row.tenant_name || row.tenant_full_name,
    tenant_phone: row.tenant_phone,
    amount: Number(row.amount),
    amount_display: formatMoney(row.amount),
    payment_method: row.payment_method,
    apply_to: row.apply_to,
    apply_to_label: getApplyToLabel(row.apply_to),
    payment_source: row.payment_source,
    phone: row.phone,
    reference: row.reference,
    notes: row.notes,
    received_at: row.received_at,
    status: row.status,
    status_label: getStatusLabel(row.status),
    matched_at: row.matched_at,
    matched_by: row.matched_by ? Number(row.matched_by) : null,
    matched_by_name: row.matched_by_name,
    recorded_by: row.recorded_by ? Number(row.recorded_by) : null,
    recorded_by_name: row.recorded_by_name,
    created_at: row.created_at,
  };
}

async function assertTenantAccess(user, tenantId) {
  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        SELECT
          t.*,
          p.name AS property_name,
          u.unit_number,
          CONCAT(owner.first_name, ' ', owner.last_name) AS owner_name
        FROM tenants t
        INNER JOIN properties p ON p.id = t.property_id
        INNER JOIN units u ON u.id = t.unit_id
        INNER JOIN users owner ON owner.id = t.owner_id
        WHERE t.id = $1
          AND t.owner_id = $2
          AND t.status != 'archived'
        `,
        [tenantId, ownerId]
      )
    : await db.query(
        `
        SELECT
          t.*,
          p.name AS property_name,
          u.unit_number,
          CONCAT(owner.first_name, ' ', owner.last_name) AS owner_name
        FROM tenants t
        INNER JOIN properties p ON p.id = t.property_id
        INNER JOIN units u ON u.id = t.unit_id
        INNER JOIN users owner ON owner.id = t.owner_id
        WHERE t.id = $1
          AND t.status != 'archived'
        `,
        [tenantId]
      );

  if (!result.rows[0]) {
    throw new Error('Tenant not found');
  }

  return result.rows[0];
}

async function allocatePayment(
  tenantId,
  amount,
  applyTo,
  paymentMethod,
  reference,
  phone,
  notes,
  receivedAt,
  user,
  ipAddress
) {
  // Get current tenant status
  const tenantResult = await db.query(
    `
    SELECT 
      id, 
      owner_id, 
      property_id, 
      unit_id,
      rent_deposit_amount,
      rent_deposit_paid,
      electricity_deposit_amount,
      electricity_deposit_paid,
      water_deposit_amount,
      water_deposit_paid,
      monthly_rent
    FROM tenants
    WHERE id = $1 
      AND status != 'archived'
    `,
    [tenantId]
  );

  const tenant = tenantResult.rows[0];

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  // Manual payments have an authenticated user.
  // Automatic provider callbacks such as M-Pesa do not.
  const actorUserId = user?.id || null;

  let remainingAmount = Number(amount);

  let rentDepositApplied = 0;
  let waterDepositApplied = 0;
  let rentApplied = 0;
  let waterBillApplied = 0;

  let depositFullyPaid = false;

  // ============================================================
  // 1. CHECK RENT DEPOSIT
  // ============================================================
  // Any payment coming through the rent account first clears
  // the tenant's outstanding rent deposit.
  if (applyTo === 'rent_balance' || applyTo === 'rent_deposit') {
    const depositRequired = Number(
      tenant.rent_deposit_amount || 0
    );

    const depositPaid = Number(
      tenant.rent_deposit_paid || 0
    );

    const depositRemaining =
      depositRequired - depositPaid;

    if (depositRemaining > 0) {
      if (remainingAmount >= depositRemaining) {
        rentDepositApplied = depositRemaining;

        remainingAmount -= depositRemaining;

        depositFullyPaid = true;

        await db.query(
          `
          UPDATE tenants
          SET rent_deposit_paid = rent_deposit_paid + $1
          WHERE id = $2
          `,
          [
            rentDepositApplied,
            tenantId,
          ]
        );
      } else {
        rentDepositApplied = remainingAmount;

        remainingAmount = 0;

        await db.query(
          `
          UPDATE tenants
          SET rent_deposit_paid = rent_deposit_paid + $1
          WHERE id = $2
          `,
          [
            rentDepositApplied,
            tenantId,
          ]
        );
      }
    } else {
      depositFullyPaid = true;
    }
  }

  // ============================================================
  // 2. CHECK WATER DEPOSIT
  // ============================================================
  // Any payment coming through the water account first clears
  // the tenant's outstanding water deposit.
  if (applyTo === 'water_bill') {
    const waterDepositRequired = Number(
      tenant.water_deposit_amount || DEFAULT_WATER_DEPOSIT
    );

    const waterDepositPaid = Number(
      tenant.water_deposit_paid || 0
    );

    const waterDepositRemaining =
      waterDepositRequired - waterDepositPaid;

    if (waterDepositRemaining > 0) {
      if (remainingAmount >= waterDepositRemaining) {
        waterDepositApplied = waterDepositRemaining;

        remainingAmount -= waterDepositRemaining;

        depositFullyPaid = true;

        await db.query(
          `
          UPDATE tenants
          SET water_deposit_paid = water_deposit_paid + $1
          WHERE id = $2
          `,
          [
            waterDepositApplied,
            tenantId,
          ]
        );
      } else {
        waterDepositApplied = remainingAmount;

        remainingAmount = 0;

        await db.query(
          `
          UPDATE tenants
          SET water_deposit_paid = water_deposit_paid + $1
          WHERE id = $2
          `,
          [
            waterDepositApplied,
            tenantId,
          ]
        );
      }
    } else {
      depositFullyPaid = true;
    }
  }

  // ============================================================
  // 3. APPLY REMAINING AMOUNT
  // ============================================================
  // Only money remaining after the relevant deposit has been
  // fully paid can go toward rent or a water bill.
  if (remainingAmount > 0 && depositFullyPaid) {
    if (applyTo === 'water_bill') {
      waterBillApplied = await applyToWaterBill(
        tenantId,
        remainingAmount
      );

      remainingAmount = 0;
    } else if (
      applyTo === 'rent_balance' ||
      applyTo === 'rent_deposit'
    ) {
      rentApplied = remainingAmount;

      remainingAmount = 0;
    }
  }

  // ============================================================
  // 4. CREATE PAYMENT RECORDS
  // ============================================================

  const payments = [];

  // ============================================================
  // 4A. RENT DEPOSIT PAYMENT
  // ============================================================

  if (rentDepositApplied > 0) {
    const depositPayment = await db.query(
      `
      INSERT INTO payments (
        owner_id,
        property_id,
        unit_id,
        tenant_id,
        amount,
        payment_method,
        apply_to,
        payment_source,
        phone,
        reference,
        notes,
        received_at,
        status,
        recorded_by,
        matched_by,
        matched_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        COALESCE($12::TIMESTAMPTZ, CURRENT_TIMESTAMP),
        'matched',
        $13,
        $13,
        CURRENT_TIMESTAMP
      )
      RETURNING *
      `,
      [
        tenant.owner_id,
        tenant.property_id,
        tenant.unit_id,
        tenantId,
        rentDepositApplied,
        paymentMethod || 'mpesa_auto',
        'rent_deposit',
        paymentMethod === 'mpesa_auto'
          ? 'mpesa_auto'
          : 'manual',
        phone || null,
        reference
          ? `${reference}-DEPOSIT`
          : null,
        notes
          ? `${notes} (rent deposit)`
          : 'Rent deposit payment',
        receivedAt || null,
        actorUserId,
      ]
    );

    payments.push(depositPayment.rows[0]);
  }

  // ============================================================
  // 4B. WATER DEPOSIT PAYMENT
  // ============================================================

  if (waterDepositApplied > 0) {
    const waterDepositPayment = await db.query(
      `
      INSERT INTO payments (
        owner_id,
        property_id,
        unit_id,
        tenant_id,
        amount,
        payment_method,
        apply_to,
        payment_source,
        phone,
        reference,
        notes,
        received_at,
        status,
        recorded_by,
        matched_by,
        matched_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        COALESCE($12::TIMESTAMPTZ, CURRENT_TIMESTAMP),
        'matched',
        $13,
        $13,
        CURRENT_TIMESTAMP
      )
      RETURNING *
      `,
      [
        tenant.owner_id,
        tenant.property_id,
        tenant.unit_id,
        tenantId,
        waterDepositApplied,
        paymentMethod || 'mpesa_auto',
        'water_deposit',
        paymentMethod === 'mpesa_auto'
          ? 'mpesa_auto'
          : 'manual',
        phone || null,
        reference
          ? `${reference}-WATER-DEPOSIT`
          : null,
        notes
          ? `${notes} (water deposit)`
          : 'Water deposit payment',
        receivedAt || null,
        actorUserId,
      ]
    );

    payments.push(
      waterDepositPayment.rows[0]
    );
  }

  // ============================================================
  // 4C. RENT PAYMENT
  // ============================================================

  if (rentApplied > 0) {
    const rentPayment = await db.query(
      `
      INSERT INTO payments (
        owner_id,
        property_id,
        unit_id,
        tenant_id,
        amount,
        payment_method,
        apply_to,
        payment_source,
        phone,
        reference,
        notes,
        received_at,
        status,
        recorded_by,
        matched_by,
        matched_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        COALESCE($12::TIMESTAMPTZ, CURRENT_TIMESTAMP),
        'matched',
        $13,
        $13,
        CURRENT_TIMESTAMP
      )
      RETURNING *
      `,
      [
        tenant.owner_id,
        tenant.property_id,
        tenant.unit_id,
        tenantId,
        rentApplied,
        paymentMethod || 'mpesa_auto',
        'rent_balance',
        paymentMethod === 'mpesa_auto'
          ? 'mpesa_auto'
          : 'manual',
        phone || null,
        reference || null,
        notes || 'Rent payment',
        receivedAt || null,
        actorUserId,
      ]
    );

    payments.push(rentPayment.rows[0]);
  }

  // ============================================================
  // 4D. WATER BILL PAYMENT
  // ============================================================

  if (waterBillApplied > 0) {
    const waterPayment = await db.query(
      `
      INSERT INTO payments (
        owner_id,
        property_id,
        unit_id,
        tenant_id,
        amount,
        payment_method,
        apply_to,
        payment_source,
        phone,
        reference,
        notes,
        received_at,
        status,
        recorded_by,
        matched_by,
        matched_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        COALESCE($12::TIMESTAMPTZ, CURRENT_TIMESTAMP),
        'matched',
        $13,
        $13,
        CURRENT_TIMESTAMP
      )
      RETURNING *
      `,
      [
        tenant.owner_id,
        tenant.property_id,
        tenant.unit_id,
        tenantId,
        waterBillApplied,
        paymentMethod || 'mpesa_auto',
        'water_bill',
        paymentMethod === 'mpesa_auto'
          ? 'mpesa_auto'
          : 'manual',
        phone || null,
        reference
          ? `${reference}-WATER`
          : null,
        notes
          ? `${notes} (water bill)`
          : 'Water bill payment',
        receivedAt || null,
        actorUserId,
      ]
    );

    payments.push(waterPayment.rows[0]);
  }

  // ============================================================
  // 5. ENSURE SOMETHING WAS ALLOCATED
  // ============================================================

  if (payments.length === 0) {
    throw new Error('No payment was allocated');
  }

  // ============================================================
  // 6. AUDIT LOG
  // ============================================================

  await logAudit({
    userId: actorUserId,
    action: 'PAYMENT_ALLOCATED',
    entityType: 'payment',
    entityId: payments[0]?.id || null,
    metadata: {
      tenant_id: tenantId,
      total_amount: Number(amount),
      rent_deposit_applied: rentDepositApplied,
      water_deposit_applied: waterDepositApplied,
      rent_applied: rentApplied,
      water_bill_applied: waterBillApplied,
      deposit_fully_paid: depositFullyPaid,
    },
    ipAddress,
  });

  // ============================================================
  // 7. RETURN ALLOCATION RESULT
  // ============================================================

  return {
    total_amount: Number(amount),
    rent_deposit_applied: rentDepositApplied,
    water_deposit_applied: waterDepositApplied,
    rent_applied: rentApplied,
    water_bill_applied: waterBillApplied,
    deposit_fully_paid: depositFullyPaid,
    payments,
  };
}

async function applyToWaterBill(tenantId, amount) {
  // Get oldest unpaid water bill
  const billResult = await db.query(
    `
    SELECT id, balance
    FROM water_bills
    WHERE tenant_id = $1
      AND status IN ('unpaid', 'partial')
    ORDER BY billing_month ASC
    LIMIT 1
    `,
    [tenantId]
  );

  if (!billResult.rows[0]) {
    // No unpaid bills, return 0 (payment will be unallocated or create credit)
    return 0;
  }

  const bill = billResult.rows[0];
  const remainingBalance = Number(bill.balance || 0);
  const paymentAmount = Math.min(amount, remainingBalance);

  if (paymentAmount > 0) {
    await db.query(
      `
      UPDATE water_bills
      SET 
        amount_paid = amount_paid + $1,
        balance = balance - $1,
        status = CASE 
          WHEN balance - $1 <= 0 THEN 'paid'
          ELSE 'partial'
        END
      WHERE id = $2
      `,
      [paymentAmount, bill.id]
    );
  }

  return paymentAmount;
}

async function recordManualTenantPayment(user, tenantId, data, ipAddress) {
  if (!['admin', 'owner', 'caretaker'].includes(user.role)) {
    throw new Error('You are not allowed to record payments');
  }

  const allocation = await allocatePayment(
    tenantId,
    data.amount,
    data.apply_to || 'rent_balance',
    data.payment_method,
    data.reference,
    null,
    data.notes,
    data.received_at,
    user,
    ipAddress
  );

  const payment = await getPaymentById(user, allocation.payments[0]?.id);

  return payment;
}

async function recordAutoPayment(user, data, ipAddress) {
  if (!['admin', 'owner', 'caretaker'].includes(user.role)) {
    throw new Error('You are not allowed to record payments');
  }

  const ownerId = getOwnerScope(user);
  const normalizedPhone = normalizePhone(data.phone);
  
  if (!normalizedPhone) {
    throw new Error('Invalid phone number format');
  }
  
  // Find tenant by phone
  const phoneSearch = await db.query(
    `
    SELECT DISTINCT t.id
    FROM tenants t
    LEFT JOIN tenant_payment_identities pi ON pi.tenant_id = t.id
    WHERE t.status != 'archived'
      AND t.owner_id = $1
      AND (
        t.phone = $2
        OR (pi.payment_channel = 'mpesa_phone' AND pi.normalized_value = $2 AND pi.status = 'active')
      )
    LIMIT 1
    `,
    [ownerId, normalizedPhone]
  );
  
  let tenantId = null;
  
  if (phoneSearch.rows[0]) {
    tenantId = phoneSearch.rows[0].id;
  }

  // If no tenant found, create unmatched payment
  if (!tenantId) {
    const propertyFallback = await db.query(
      `
      SELECT id FROM properties
      WHERE owner_id = $1 AND status = 'active'
      ORDER BY id LIMIT 1
      `,
      [ownerId]
    );
    
    if (!propertyFallback.rows[0]) {
      throw new Error('No property found for this owner. Please create a property first.');
    }

    const result = await db.query(
      `
      INSERT INTO payments (
        owner_id,
        property_id,
        amount,
        payment_method,
        apply_to,
        payment_source,
        phone,
        reference,
        notes,
        received_at,
        status,
        recorded_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::TIMESTAMPTZ, CURRENT_TIMESTAMP), 'unmatched', $11)
      RETURNING *
      `,
      [
        ownerId,
        propertyFallback.rows[0].id,
        data.amount,
        data.payment_method,
        data.apply_to || 'rent_balance',
        data.payment_method === 'mpesa_auto' ? 'mpesa_auto' : 'bank_auto',
        normalizedPhone,
        data.reference || null,
        data.notes || null,
        data.received_at || null,
        user.id,
      ]
    );

    await logAudit({
      userId: user.id,
      action: 'PAYMENT_RECEIVED_UNMATCHED',
      entityType: 'payment',
      entityId: result.rows[0].id,
      metadata: {
        phone: normalizedPhone,
        amount: data.amount,
      },
      ipAddress,
    });

    return {
      success: true,
      message: 'Payment received - needs manual matching',
      payment: await getPaymentById(user, result.rows[0].id),
    };
  }

  // Tenant found - allocate payment intelligently
  const allocation = await allocatePayment(
    tenantId,
    data.amount,
    data.apply_to || 'rent_balance',
    data.payment_method,
    data.reference,
    normalizedPhone,
    data.notes,
    data.received_at,
    user,
    ipAddress
  );

  const payment = await getPaymentById(user, allocation.payments[0]?.id);

  let message = 'Payment allocated successfully';
  if (allocation.rent_deposit_applied > 0) {
    message = `KES ${formatMoney(allocation.rent_deposit_applied)} applied to rent deposit`;
  }
  if (allocation.water_deposit_applied > 0) {
    message = `KES ${formatMoney(allocation.water_deposit_applied)} applied to water deposit`;
  }
  if (allocation.rent_applied > 0) {
    message = `KES ${formatMoney(allocation.rent_applied)} applied to rent`;
  }
  if (allocation.water_bill_applied > 0) {
    message = `KES ${formatMoney(allocation.water_bill_applied)} applied to water bill`;
  }

  return {
    success: true,
    message: message,
    payment: payment,
    allocation: {
      rent_deposit_applied: allocation.rent_deposit_applied,
      water_deposit_applied: allocation.water_deposit_applied,
      rent_applied: allocation.rent_applied,
      water_bill_applied: allocation.water_bill_applied,
      deposit_fully_paid: allocation.deposit_fully_paid,
    },
  };
}

async function getPaymentById(user, paymentId) {
  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        SELECT
          pay.*,
          t.full_name AS tenant_name,
          t.phone AS tenant_phone,
          p.name AS property_name,
          u.unit_number,
          CONCAT(recorder.first_name, ' ', recorder.last_name) AS recorded_by_name,
          CONCAT(matcher.first_name, ' ', matcher.last_name) AS matched_by_name
        FROM payments pay
        LEFT JOIN tenants t ON t.id = pay.tenant_id
        LEFT JOIN properties p ON p.id = pay.property_id
        LEFT JOIN units u ON u.id = pay.unit_id
        LEFT JOIN users recorder ON recorder.id = pay.recorded_by
        LEFT JOIN users matcher ON matcher.id = pay.matched_by
        WHERE pay.id = $1
          AND pay.owner_id = $2
        `,
        [paymentId, ownerId]
      )
    : await db.query(
        `
        SELECT
          pay.*,
          t.full_name AS tenant_name,
          t.phone AS tenant_phone,
          p.name AS property_name,
          u.unit_number,
          CONCAT(recorder.first_name, ' ', recorder.last_name) AS recorded_by_name,
          CONCAT(matcher.first_name, ' ', matcher.last_name) AS matched_by_name
        FROM payments pay
        LEFT JOIN tenants t ON t.id = pay.tenant_id
        LEFT JOIN properties p ON p.id = pay.property_id
        LEFT JOIN units u ON u.id = pay.unit_id
        LEFT JOIN users recorder ON recorder.id = pay.recorded_by
        LEFT JOIN users matcher ON matcher.id = pay.matched_by
        WHERE pay.id = $1
        `,
        [paymentId]
      );

  return result.rows[0] ? publicPayment(result.rows[0]) : null;
}

async function getUnmatchedPayments(user) {
  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        SELECT
          pay.*,
          t.full_name AS tenant_name,
          t.phone AS tenant_phone,
          p.name AS property_name,
          u.unit_number,
          CONCAT(recorder.first_name, ' ', recorder.last_name) AS recorded_by_name,
          CONCAT(matcher.first_name, ' ', matcher.last_name) AS matched_by_name
        FROM payments pay
        LEFT JOIN tenants t ON t.id = pay.tenant_id
        LEFT JOIN properties p ON p.id = pay.property_id
        LEFT JOIN units u ON u.id = pay.unit_id
        LEFT JOIN users recorder ON recorder.id = pay.recorded_by
        LEFT JOIN users matcher ON matcher.id = pay.matched_by
        WHERE pay.owner_id = $1
          AND pay.status = 'unmatched'
        ORDER BY pay.received_at DESC
        `,
        [ownerId]
      )
    : await db.query(
        `
        SELECT
          pay.*,
          t.full_name AS tenant_name,
          t.phone AS tenant_phone,
          p.name AS property_name,
          u.unit_number,
          CONCAT(recorder.first_name, ' ', recorder.last_name) AS recorded_by_name,
          CONCAT(matcher.first_name, ' ', matcher.last_name) AS matched_by_name
        FROM payments pay
        LEFT JOIN tenants t ON t.id = pay.tenant_id
        LEFT JOIN properties p ON p.id = pay.property_id
        LEFT JOIN units u ON u.id = pay.unit_id
        LEFT JOIN users recorder ON recorder.id = pay.recorded_by
        LEFT JOIN users matcher ON matcher.id = pay.matched_by
        WHERE pay.status = 'unmatched'
        ORDER BY pay.received_at DESC
        `
      );

  return result.rows.map(publicPayment);
}

async function listTenantPayments(user, tenantId) {
  await assertTenantAccess(user, tenantId);
  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        SELECT
          pay.*,
          t.full_name AS tenant_name,
          t.phone AS tenant_phone,
          p.name AS property_name,
          u.unit_number,
          CONCAT(recorder.first_name, ' ', recorder.last_name) AS recorded_by_name,
          CONCAT(matcher.first_name, ' ', matcher.last_name) AS matched_by_name
        FROM payments pay
        LEFT JOIN tenants t ON t.id = pay.tenant_id
        LEFT JOIN properties p ON p.id = pay.property_id
        LEFT JOIN units u ON u.id = pay.unit_id
        LEFT JOIN users recorder ON recorder.id = pay.recorded_by
        LEFT JOIN users matcher ON matcher.id = pay.matched_by
        WHERE pay.tenant_id = $1
          AND pay.owner_id = $2
          AND pay.status != 'reversed'
        ORDER BY pay.received_at DESC
        `,
        [tenantId, ownerId]
      )
    : await db.query(
        `
        SELECT
          pay.*,
          t.full_name AS tenant_name,
          t.phone AS tenant_phone,
          p.name AS property_name,
          u.unit_number,
          CONCAT(recorder.first_name, ' ', recorder.last_name) AS recorded_by_name,
          CONCAT(matcher.first_name, ' ', matcher.last_name) AS matched_by_name
        FROM payments pay
        LEFT JOIN tenants t ON t.id = pay.tenant_id
        LEFT JOIN properties p ON p.id = pay.property_id
        LEFT JOIN units u ON u.id = pay.unit_id
        LEFT JOIN users recorder ON recorder.id = pay.recorded_by
        LEFT JOIN users matcher ON matcher.id = pay.matched_by
        WHERE pay.tenant_id = $1
          AND pay.status != 'reversed'
        ORDER BY pay.received_at DESC
        `,
        [tenantId]
      );

  return result.rows.map(publicPayment);
}

async function matchUnmatchedPayment(user, paymentId, data, ipAddress) {
  if (!['admin', 'owner'].includes(user.role)) {
    throw new Error('Only owners can match payments');
  }

  const ownerId = getOwnerScope(user);

  const paymentResult = ownerId
    ? await db.query(
        `
        SELECT pay.*, p.name AS property_name
        FROM payments pay
        INNER JOIN properties p ON p.id = pay.property_id
        WHERE pay.id = $1
          AND pay.owner_id = $2
          AND pay.status = 'unmatched'
        `,
        [paymentId, ownerId]
      )
    : await db.query(
        `
        SELECT pay.*, p.name AS property_name
        FROM payments pay
        INNER JOIN properties p ON p.id = pay.property_id
        WHERE pay.id = $1
          AND pay.status = 'unmatched'
        `,
        [paymentId]
      );

  if (!paymentResult.rows[0]) {
    throw new Error('Unmatched payment not found');
  }

  const payment = paymentResult.rows[0];
  const tenant = await assertTenantAccess(user, data.tenant_id);

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Delete the unmatched payment
    await client.query(
      `
      DELETE FROM payments WHERE id = $1 AND owner_id = $2
      `,
      [paymentId, ownerId]
    );

    // Re-allocate the payment
    const allocation = await allocatePayment(
      data.tenant_id,
      payment.amount,
      data.apply_to || 'rent_balance',
      payment.payment_method,
      payment.reference,
      payment.phone,
      data.notes || payment.notes,
      payment.received_at,
      user,
      ipAddress
    );

    // Save payment identity if requested
    if (data.save_as_identity && payment.phone) {
      const identityChannel = payment.payment_method === 'mpesa_auto' 
        ? 'mpesa_phone' 
        : 'bank_reference';

      const accountFor = data.apply_to === 'rent_balance' || data.apply_to === 'rent_deposit' 
        ? 'rent' 
        : 'water';

      const existingIdentity = await client.query(
        `
        SELECT id
        FROM tenant_payment_identities
        WHERE tenant_id = $1
          AND account_for = $2
          AND payment_channel = $3
          AND status = 'active'
        `,
        [data.tenant_id, accountFor, identityChannel]
      );

      if (!existingIdentity.rows[0]) {
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
            tenant.owner_id,
            data.tenant_id,
            accountFor,
            identityChannel,
            payment.phone,
            payment.phone,
          ]
        );
      }
    }

    await client.query('COMMIT');

    await logAudit({
      userId: user.id,
      action: 'PAYMENT_MATCHED',
      entityType: 'payment',
      entityId: allocation.payments[0]?.id || null,
      metadata: {
        original_payment_id: paymentId,
        tenant_id: data.tenant_id,
        tenant_name: tenant.full_name,
        amount: payment.amount,
        apply_to: data.apply_to,
        saved_as_identity: data.save_as_identity,
        rent_deposit_applied: allocation.rent_deposit_applied,
        water_deposit_applied: allocation.water_deposit_applied,
        rent_applied: allocation.rent_applied,
        water_bill_applied: allocation.water_bill_applied,
      },
      ipAddress,
    });

    return getPaymentById(user, allocation.payments[0]?.id);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function searchTenantsForMatching(user, searchTerm) {
  const ownerId = getOwnerScope(user);

  if (!searchTerm || searchTerm.length < 2) {
    return [];
  }

  const searchPattern = `%${searchTerm}%`;

  const result = ownerId
    ? await db.query(
        `
        SELECT
          t.id,
          t.full_name,
          t.phone,
          t.monthly_rent,
          t.rent_deposit_amount,
          t.rent_deposit_paid,
          t.water_deposit_amount,
          t.water_deposit_paid,
          u.unit_number,
          p.name AS property_name,
          (
            SELECT COALESCE(SUM(amount), 0)
            FROM payments
            WHERE tenant_id = t.id
              AND status = 'matched'
              AND apply_to = 'rent_balance'
          ) AS rent_paid,
          t.monthly_rent - COALESCE(
            (
              SELECT SUM(amount)
              FROM payments
              WHERE tenant_id = t.id
                AND status = 'matched'
                AND apply_to = 'rent_balance'
            ), 0
          ) AS balance
        FROM tenants t
        INNER JOIN units u ON u.id = t.unit_id
        INNER JOIN properties p ON p.id = t.property_id
        WHERE t.owner_id = $1
          AND t.status != 'archived'
          AND (
            t.full_name ILIKE $2
            OR t.phone ILIKE $2
            OR u.unit_number ILIKE $2
          )
        ORDER BY t.full_name
        LIMIT 10
        `,
        [ownerId, searchPattern]
      )
    : await db.query(
        `
        SELECT
          t.id,
          t.full_name,
          t.phone,
          t.monthly_rent,
          t.rent_deposit_amount,
          t.rent_deposit_paid,
          t.water_deposit_amount,
          t.water_deposit_paid,
          u.unit_number,
          p.name AS property_name,
          (
            SELECT COALESCE(SUM(amount), 0)
            FROM payments
            WHERE tenant_id = t.id
              AND status = 'matched'
              AND apply_to = 'rent_balance'
          ) AS rent_paid,
          t.monthly_rent - COALESCE(
            (
              SELECT SUM(amount)
              FROM payments
              WHERE tenant_id = t.id
                AND status = 'matched'
                AND apply_to = 'rent_balance'
            ), 0
          ) AS balance
        FROM tenants t
        INNER JOIN units u ON u.id = t.unit_id
        INNER JOIN properties p ON p.id = t.property_id
        WHERE t.status != 'archived'
          AND (
            t.full_name ILIKE $1
            OR t.phone ILIKE $1
            OR u.unit_number ILIKE $1
          )
        ORDER BY t.full_name
        LIMIT 10
        `,
        [searchPattern]
      );

  return result.rows.map((row) => ({
    id: Number(row.id),
    full_name: row.full_name,
    phone: row.phone,
    unit_number: row.unit_number,
    property_name: row.property_name,
    monthly_rent: Number(row.monthly_rent || 0),
    rent_deposit_amount: Number(row.rent_deposit_amount || 0),
    rent_deposit_paid: Number(row.rent_deposit_paid || 0),
    water_deposit_amount: Number(row.water_deposit_amount || 0),
    water_deposit_paid: Number(row.water_deposit_paid || 0),
    balance: Number(row.balance || 0),
    balance_display: formatMoney(row.balance || 0),
    rent_paid: Number(row.rent_paid || 0),
    rent_paid_display: formatMoney(row.rent_paid || 0),
  }));
}

module.exports = {
  allocatePayment,
  recordManualTenantPayment,
  recordAutoPayment,
  getPaymentById,
  getUnmatchedPayments,
  listTenantPayments,
  matchUnmatchedPayment,
  searchTenantsForMatching,
};