const db = require('../config/db');
const { logAudit } = require('./audit_service');

function getOwnerScope(user) {
  if (user.role === 'admin') return null;
  if (user.role === 'caretaker') return user.owner_id;
  return user.id;
}

function formatMoney(amount) {
  return `KES ${Number(amount || 0).toLocaleString('en-KE')}`;
}

function formatDate(date) {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString('en-KE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ============================================================
// OCCUPANCY REPORT
// ============================================================

async function getOccupancyReport(user, filters = {}) {
  const ownerId = getOwnerScope(user);
  const conditions = [];
  const params = [];

  if (ownerId) {
    params.push(ownerId);
    conditions.push(`u.owner_id = $${params.length}`);
  }

  if (filters.property_id) {
    params.push(filters.property_id);
    conditions.push(`u.property_id = $${params.length}`);
  }

  conditions.push(`u.status != 'archived'`);

  const result = await db.query(
    `
    SELECT
      COUNT(*) AS total_units,
      SUM(CASE WHEN u.status = 'occupied' THEN 1 ELSE 0 END) AS occupied,
      SUM(CASE WHEN u.status = 'vacant' THEN 1 ELSE 0 END) AS vacant,
      SUM(CASE WHEN u.status = 'maintenance' THEN 1 ELSE 0 END) AS maintenance,
      COUNT(DISTINCT u.property_id) AS total_properties
    FROM units u
    WHERE ${conditions.join(' AND ')}
    `,
    params
  );

  const stats = result.rows[0];
  const totalUnits = Number(stats.total_units || 0);
  const occupied = Number(stats.occupied || 0);
  const vacant = Number(stats.vacant || 0);
  const maintenance = Number(stats.maintenance || 0);
  const occupancyRate = totalUnits > 0 ? (occupied / totalUnits) * 100 : 0;

  // Get occupancy by property
  const byProperty = await db.query(
    `
    SELECT
      p.id AS property_id,
      p.name AS property_name,
      COUNT(*) AS total_units,
      SUM(CASE WHEN u.status = 'occupied' THEN 1 ELSE 0 END) AS occupied,
      SUM(CASE WHEN u.status = 'vacant' THEN 1 ELSE 0 END) AS vacant
    FROM units u
    INNER JOIN properties p ON p.id = u.property_id
    WHERE ${conditions.join(' AND ')}
    GROUP BY p.id, p.name
    ORDER BY p.name
    `,
    params
  );

  return {
    summary: {
      total_units: totalUnits,
      occupied: occupied,
      vacant: vacant,
      maintenance: maintenance,
      occupancy_rate: Math.round(occupancyRate * 10) / 10,
      total_properties: Number(stats.total_properties || 0),
    },
    by_property: byProperty.rows.map((row) => ({
      property_id: Number(row.property_id),
      property_name: row.property_name,
      total_units: Number(row.total_units || 0),
      occupied: Number(row.occupied || 0),
      vacant: Number(row.vacant || 0),
      occupancy_rate: Number(row.total_units || 0) > 0
        ? Math.round((Number(row.occupied || 0) / Number(row.total_units || 0)) * 1000) / 10
        : 0,
    })),
  };
}

// ============================================================
// ARREARS REPORT
// ============================================================

async function getArrearsReport(user, filters = {}) {
  const ownerId = getOwnerScope(user);
  const conditions = [];
  const params = [];

  if (ownerId) {
    params.push(ownerId);
    conditions.push(`t.owner_id = $${params.length}`);
  }

  if (filters.property_id) {
    params.push(filters.property_id);
    conditions.push(`t.property_id = $${params.length}`);
  }

  conditions.push(`t.status = 'active'`);

  const minBalance = filters.min_balance || 0;

  const result = await db.query(
    `
    SELECT
      t.id AS tenant_id,
      t.full_name,
      t.phone,
      t.monthly_rent,
      u.unit_number,
      p.name AS property_name,
      COALESCE(
        (SELECT SUM(amount) FROM payments WHERE tenant_id = t.id AND status = 'matched' AND apply_to = 'rent_balance'),
        0
      ) AS rent_paid,
      t.monthly_rent - COALESCE(
        (SELECT SUM(amount) FROM payments WHERE tenant_id = t.id AND status = 'matched' AND apply_to = 'rent_balance'),
        0
      ) AS balance
    FROM tenants t
    INNER JOIN units u ON u.id = t.unit_id
    INNER JOIN properties p ON p.id = t.property_id
    WHERE ${conditions.join(' AND ')}
    HAVING t.monthly_rent - COALESCE(
      (SELECT SUM(amount) FROM payments WHERE tenant_id = t.id AND status = 'matched' AND apply_to = 'rent_balance'),
      0
    ) >= $${params.length + 1}
    ORDER BY balance DESC
    `,
    [...params, minBalance]
  );

  const totalArrears = result.rows.reduce((sum, row) => sum + Number(row.balance || 0), 0);

  // Get arrears by property
  const byProperty = await db.query(
    `
    SELECT
      p.id AS property_id,
      p.name AS property_name,
      COUNT(t.id) AS tenant_count,
      SUM(
        t.monthly_rent - COALESCE(
          (SELECT SUM(amount) FROM payments WHERE tenant_id = t.id AND status = 'matched' AND apply_to = 'rent_balance'),
          0
        )
      ) AS total_arrears
    FROM tenants t
    INNER JOIN properties p ON p.id = t.property_id
    WHERE ${conditions.join(' AND ')}
    GROUP BY p.id, p.name
    HAVING SUM(
      t.monthly_rent - COALESCE(
        (SELECT SUM(amount) FROM payments WHERE tenant_id = t.id AND status = 'matched' AND apply_to = 'rent_balance'),
        0
      )
    ) > 0
    ORDER BY total_arrears DESC
    `,
    params
  );

  return {
    summary: {
      total_tenants_in_arrears: result.rows.length,
      total_arrears: totalArrears,
      total_arrears_display: formatMoney(totalArrears),
    },
    tenants: result.rows.map((row) => ({
      tenant_id: Number(row.tenant_id),
      full_name: row.full_name,
      phone: row.phone,
      unit_number: row.unit_number,
      property_name: row.property_name,
      monthly_rent: Number(row.monthly_rent || 0),
      monthly_rent_display: formatMoney(row.monthly_rent || 0),
      rent_paid: Number(row.rent_paid || 0),
      rent_paid_display: formatMoney(row.rent_paid || 0),
      balance: Number(row.balance || 0),
      balance_display: formatMoney(row.balance || 0),
    })),
    by_property: byProperty.rows.map((row) => ({
      property_id: Number(row.property_id),
      property_name: row.property_name,
      tenant_count: Number(row.tenant_count || 0),
      total_arrears: Number(row.total_arrears || 0),
      total_arrears_display: formatMoney(row.total_arrears || 0),
    })),
  };
}

// ============================================================
// RENT COLLECTION REPORT
// ============================================================

async function getRentCollectionReport(user, filters = {}) {
  const ownerId = getOwnerScope(user);
  const conditions = [`status = 'matched'`, `apply_to = 'rent_balance'`];
  const params = [];

  if (ownerId) {
    params.push(ownerId);
    conditions.push(`owner_id = $${params.length}`);
  }

  if (filters.property_id) {
    params.push(filters.property_id);
    conditions.push(`property_id = $${params.length}`);
  }

  if (filters.start_date) {
    params.push(filters.start_date);
    conditions.push(`received_at >= $${params.length}`);
  }

  if (filters.end_date) {
    params.push(filters.end_date);
    conditions.push(`received_at <= $${params.length}`);
  }

  // Get total collected
  const collectedResult = await db.query(
    `
    SELECT COALESCE(SUM(amount), 0) AS total_collected
    FROM payments
    WHERE ${conditions.join(' AND ')}
    `,
    params
  );

  // Get monthly breakdown
  const monthlyResult = await db.query(
    `
    SELECT
      DATE_TRUNC('month', received_at) AS month,
      COALESCE(SUM(amount), 0) AS total
    FROM payments
    WHERE ${conditions.join(' AND ')}
    GROUP BY DATE_TRUNC('month', received_at)
    ORDER BY month DESC
    LIMIT 12
    `,
    params
  );

  // Get by property
  const byProperty = await db.query(
    `
    SELECT
      p.id AS property_id,
      p.name AS property_name,
      COALESCE(SUM(pay.amount), 0) AS total_collected
    FROM payments pay
    INNER JOIN properties p ON p.id = pay.property_id
    WHERE ${conditions.join(' AND ')}
    GROUP BY p.id, p.name
    ORDER BY total_collected DESC
    `,
    params
  );

  return {
    summary: {
      total_collected: Number(collectedResult.rows[0].total_collected || 0),
      total_collected_display: formatMoney(collectedResult.rows[0].total_collected || 0),
    },
    monthly: monthlyResult.rows.map((row) => ({
      month: row.month,
      month_label: formatDate(row.month),
      total: Number(row.total || 0),
      total_display: formatMoney(row.total || 0),
    })),
    by_property: byProperty.rows.map((row) => ({
      property_id: Number(row.property_id),
      property_name: row.property_name,
      total_collected: Number(row.total_collected || 0),
      total_collected_display: formatMoney(row.total_collected || 0),
    })),
  };
}

// ============================================================
// WATER BILLING REPORT
// ============================================================

async function getWaterBillingReport(user, filters = {}) {
  const ownerId = getOwnerScope(user);
  const conditions = [];
  const params = [];

  if (ownerId) {
    params.push(ownerId);
    conditions.push(`b.owner_id = $${params.length}`);
  }

  if (filters.property_id) {
    params.push(filters.property_id);
    conditions.push(`b.property_id = $${params.length}`);
  }

  if (filters.start_date) {
    params.push(filters.start_date);
    conditions.push(`b.billing_month >= $${params.length}`);
  }

  if (filters.end_date) {
    params.push(filters.end_date);
    conditions.push(`b.billing_month <= $${params.length}`);
  }

  const result = await db.query(
    `
    SELECT
      COUNT(*) AS total_bills,
      COALESCE(SUM(b.total_amount), 0) AS total_billed,
      COALESCE(SUM(b.amount_paid), 0) AS total_collected,
      COALESCE(SUM(b.balance), 0) AS total_outstanding,
      COALESCE(SUM(b.units_consumed), 0) AS total_units_consumed
    FROM water_bills b
    WHERE ${conditions.join(' AND ')}
    `,
    params
  );

  // Get by property
  const byProperty = await db.query(
    `
    SELECT
      p.id AS property_id,
      p.name AS property_name,
      COUNT(b.id) AS total_bills,
      COALESCE(SUM(b.total_amount), 0) AS total_billed,
      COALESCE(SUM(b.amount_paid), 0) AS total_collected,
      COALESCE(SUM(b.balance), 0) AS total_outstanding
    FROM water_bills b
    INNER JOIN properties p ON p.id = b.property_id
    WHERE ${conditions.join(' AND ')}
    GROUP BY p.id, p.name
    ORDER BY total_billed DESC
    `,
    params
  );

  const stats = result.rows[0];
  const totalBilled = Number(stats.total_billed || 0);
  const totalCollected = Number(stats.total_collected || 0);
  const collectionRate = totalBilled > 0 ? (totalCollected / totalBilled) * 100 : 0;

  return {
    summary: {
      total_bills: Number(stats.total_bills || 0),
      total_billed: totalBilled,
      total_billed_display: formatMoney(totalBilled),
      total_collected: totalCollected,
      total_collected_display: formatMoney(totalCollected),
      total_outstanding: Number(stats.total_outstanding || 0),
      total_outstanding_display: formatMoney(stats.total_outstanding || 0),
      total_units_consumed: Number(stats.total_units_consumed || 0),
      collection_rate: Math.round(collectionRate * 10) / 10,
    },
    by_property: byProperty.rows.map((row) => ({
      property_id: Number(row.property_id),
      property_name: row.property_name,
      total_bills: Number(row.total_bills || 0),
      total_billed: Number(row.total_billed || 0),
      total_billed_display: formatMoney(row.total_billed || 0),
      total_collected: Number(row.total_collected || 0),
      total_collected_display: formatMoney(row.total_collected || 0),
      total_outstanding: Number(row.total_outstanding || 0),
      total_outstanding_display: formatMoney(row.total_outstanding || 0),
    })),
  };
}

// ============================================================
// SMS USAGE REPORT
// ============================================================

async function getSmsUsageReport(user) {
  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        SELECT
          (SELECT COUNT(*) FROM sms_messages WHERE owner_id = $1 AND created_at >= date_trunc('month', CURRENT_DATE)) AS sent_this_month,
          (SELECT COALESCE(SUM(cost), 0) FROM sms_messages WHERE owner_id = $1 AND created_at >= date_trunc('month', CURRENT_DATE)) AS cost_this_month,
          (SELECT COUNT(*) FROM sms_messages WHERE owner_id = $1 AND status = 'delivered') AS delivered,
          (SELECT COUNT(*) FROM sms_messages WHERE owner_id = $1 AND status = 'failed') AS failed,
          (SELECT COUNT(*) FROM sms_messages WHERE owner_id = $1 AND status = 'pending') AS pending,
          (SELECT COUNT(*) FROM sms_messages WHERE owner_id = $1 AND status = 'scheduled') AS scheduled,
          (SELECT COUNT(*) FROM sms_broadcasts WHERE owner_id = $1) AS total_broadcasts
        `,
        [ownerId]
      )
    : await db.query(
        `
        SELECT
          (SELECT COUNT(*) FROM sms_messages WHERE created_at >= date_trunc('month', CURRENT_DATE)) AS sent_this_month,
          (SELECT COALESCE(SUM(cost), 0) FROM sms_messages WHERE created_at >= date_trunc('month', CURRENT_DATE)) AS cost_this_month,
          (SELECT COUNT(*) FROM sms_messages WHERE status = 'delivered') AS delivered,
          (SELECT COUNT(*) FROM sms_messages WHERE status = 'failed') AS failed,
          (SELECT COUNT(*) FROM sms_messages WHERE status = 'pending') AS pending,
          (SELECT COUNT(*) FROM sms_messages WHERE status = 'scheduled') AS scheduled,
          (SELECT COUNT(*) FROM sms_broadcasts) AS total_broadcasts
        `
      );

  const stats = result.rows[0];
  const totalMessages = Number(stats.delivered || 0) + Number(stats.failed || 0) + Number(stats.pending || 0);
  const deliveryRate = totalMessages > 0 ? (Number(stats.delivered || 0) / totalMessages * 100) : 0;

  // Get monthly usage
  const monthly = ownerId
    ? await db.query(
        `
        SELECT
          DATE_TRUNC('month', created_at) AS month,
          COUNT(*) AS message_count,
          COALESCE(SUM(cost), 0) AS total_cost
        FROM sms_messages
        WHERE owner_id = $1
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY month DESC
        LIMIT 12
        `,
        [ownerId]
      )
    : await db.query(
        `
        SELECT
          DATE_TRUNC('month', created_at) AS month,
          COUNT(*) AS message_count,
          COALESCE(SUM(cost), 0) AS total_cost
        FROM sms_messages
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY month DESC
        LIMIT 12
        `
      );

  return {
    summary: {
      sent_this_month: Number(stats.sent_this_month || 0),
      cost_this_month: Number(stats.cost_this_month || 0),
      cost_this_month_display: formatMoney(stats.cost_this_month || 0),
      delivered: Number(stats.delivered || 0),
      failed: Number(stats.failed || 0),
      pending: Number(stats.pending || 0),
      scheduled: Number(stats.scheduled || 0),
      total_broadcasts: Number(stats.total_broadcasts || 0),
      total_messages: totalMessages,
      delivery_rate: Math.round(deliveryRate * 10) / 10,
    },
    monthly: monthly.rows.map((row) => ({
      month: row.month,
      month_label: formatDate(row.month),
      message_count: Number(row.message_count || 0),
      total_cost: Number(row.total_cost || 0),
      total_cost_display: formatMoney(row.total_cost || 0),
    })),
  };
}

// ============================================================
// TENANT STATEMENT
// ============================================================

async function getTenantStatement(user, tenantId, filters = {}) {
  const ownerId = getOwnerScope(user);

  // Get tenant details
  const tenantResult = ownerId
    ? await db.query(
        `
        SELECT t.*, p.name AS property_name, u.unit_number
        FROM tenants t
        INNER JOIN properties p ON p.id = t.property_id
        INNER JOIN units u ON u.id = t.unit_id
        WHERE t.id = $1 AND t.owner_id = $2
        `,
        [tenantId, ownerId]
      )
    : await db.query(
        `
        SELECT t.*, p.name AS property_name, u.unit_number
        FROM tenants t
        INNER JOIN properties p ON p.id = t.property_id
        INNER JOIN units u ON u.id = t.unit_id
        WHERE t.id = $1
        `,
        [tenantId]
      );

  if (!tenantResult.rows[0]) {
    throw new Error('Tenant not found');
  }

  const tenant = tenantResult.rows[0];

  // Get rent payments
  const rentConditions = [`tenant_id = $1`, `status = 'matched'`, `apply_to = 'rent_balance'`];
  const rentParams = [tenantId];

  if (filters.start_date) {
    rentParams.push(filters.start_date);
    rentConditions.push(`received_at >= $${rentParams.length}`);
  }

  if (filters.end_date) {
    rentParams.push(filters.end_date);
    rentConditions.push(`received_at <= $${rentParams.length}`);
  }

  const rentPayments = await db.query(
    `
    SELECT
      amount,
      received_at,
      payment_method,
      reference,
      notes
    FROM payments
    WHERE ${rentConditions.join(' AND ')}
    ORDER BY received_at DESC
    `,
    rentParams
  );

  // Get water bills
  const waterConditions = [`tenant_id = $1`];
  const waterParams = [tenantId];

  if (filters.start_date) {
    waterParams.push(filters.start_date);
    waterConditions.push(`billing_month >= $${waterParams.length}`);
  }

  if (filters.end_date) {
    waterParams.push(filters.end_date);
    waterConditions.push(`billing_month <= $${waterParams.length}`);
  }

  const waterBills = await db.query(
    `
    SELECT
      billing_month,
      units_consumed,
      rate_per_unit,
      total_amount,
      amount_paid,
      balance,
      status
    FROM water_bills
    WHERE ${waterConditions.join(' AND ')}
    ORDER BY billing_month DESC
    `,
    waterParams
  );

  // Calculate totals
  const totalRentPaid = rentPayments.rows.reduce((sum, p) => sum + Number(p.amount), 0);
  const totalWaterBilled = waterBills.rows.reduce((sum, b) => sum + Number(b.total_amount), 0);
  const totalWaterPaid = waterBills.rows.reduce((sum, b) => sum + Number(b.amount_paid), 0);

  return {
    tenant: {
      id: Number(tenant.id),
      full_name: tenant.full_name,
      phone: tenant.phone,
      property_name: tenant.property_name,
      unit_number: tenant.unit_number,
      monthly_rent: Number(tenant.monthly_rent || 0),
      monthly_rent_display: formatMoney(tenant.monthly_rent || 0),
      move_in_date: tenant.move_in_date,
    },
    summary: {
      total_rent_paid: totalRentPaid,
      total_rent_paid_display: formatMoney(totalRentPaid),
      total_water_billed: totalWaterBilled,
      total_water_billed_display: formatMoney(totalWaterBilled),
      total_water_paid: totalWaterPaid,
      total_water_paid_display: formatMoney(totalWaterPaid),
      rent_balance: Number(tenant.monthly_rent || 0) - totalRentPaid,
      rent_balance_display: formatMoney(Number(tenant.monthly_rent || 0) - totalRentPaid),
      water_balance: totalWaterBilled - totalWaterPaid,
      water_balance_display: formatMoney(totalWaterBilled - totalWaterPaid),
    },
    rent_payments: rentPayments.rows.map((row) => ({
      amount: Number(row.amount),
      amount_display: formatMoney(row.amount),
      received_at: row.received_at,
      received_at_display: formatDate(row.received_at),
      payment_method: row.payment_method,
      reference: row.reference,
      notes: row.notes,
    })),
    water_bills: waterBills.rows.map((row) => ({
      billing_month: row.billing_month,
      billing_month_display: formatDate(row.billing_month),
      units_consumed: Number(row.units_consumed || 0),
      rate_per_unit: Number(row.rate_per_unit || 0),
      total_amount: Number(row.total_amount || 0),
      total_amount_display: formatMoney(row.total_amount || 0),
      amount_paid: Number(row.amount_paid || 0),
      amount_paid_display: formatMoney(row.amount_paid || 0),
      balance: Number(row.balance || 0),
      balance_display: formatMoney(row.balance || 0),
      status: row.status,
    })),
  };
}

// ============================================================
// EXPORT FUNCTIONS
// ============================================================

async function generateExport(user, data, ipAddress) {
  const ownerId = getOwnerScope(user);

  // Generate the report data based on type
  let reportData = null;
  let reportName = '';

  switch (data.report_type) {
    case 'occupancy':
      reportData = await getOccupancyReport(user, { property_id: data.property_id });
      reportName = 'Occupancy Report';
      break;
    case 'arrears':
      reportData = await getArrearsReport(user, { property_id: data.property_id });
      reportName = 'Arrears Report';
      break;
    case 'rent_collection':
      reportData = await getRentCollectionReport(user, {
        property_id: data.property_id,
        start_date: data.start_date,
        end_date: data.end_date,
      });
      reportName = 'Rent Collection Report';
      break;
    case 'water_billing':
      reportData = await getWaterBillingReport(user, {
        property_id: data.property_id,
        start_date: data.start_date,
        end_date: data.end_date,
      });
      reportName = 'Water Billing Report';
      break;
    case 'sms_usage':
      reportData = await getSmsUsageReport(user);
      reportName = 'SMS Usage Report';
      break;
    case 'tenant_statement':
      if (!data.tenant_id) {
        throw new Error('Tenant ID is required for tenant statement');
      }
      reportData = await getTenantStatement(user, data.tenant_id, {
        start_date: data.start_date,
        end_date: data.end_date,
      });
      reportName = `Tenant Statement - ${reportData.tenant.full_name}`;
      break;
    case 'full_monthly_summary':
      // Combined report
      const [occupancy, arrears, rent, water, sms] = await Promise.all([
        getOccupancyReport(user, { property_id: data.property_id }),
        getArrearsReport(user, { property_id: data.property_id }),
        getRentCollectionReport(user, {
          property_id: data.property_id,
          start_date: data.start_date,
          end_date: data.end_date,
        }),
        getWaterBillingReport(user, {
          property_id: data.property_id,
          start_date: data.start_date,
          end_date: data.end_date,
        }),
        getSmsUsageReport(user),
      ]);
      reportData = { occupancy, arrears, rent, water, sms };
      reportName = 'Full Monthly Summary';
      break;
    default:
      throw new Error('Unsupported report type');
  }

  // Store the generated report
  const result = await db.query(
    `
    INSERT INTO generated_reports (
      owner_id,
      report_type,
      report_name,
      filters,
      status,
      generated_by,
      expires_at
    )
    VALUES ($1, $2, $3, $4, 'ready', $5, CURRENT_TIMESTAMP + INTERVAL '7 days')
    RETURNING *
    `,
    [
      ownerId || user.id,
      data.report_type,
      reportName,
      JSON.stringify(data),
      user.id,
    ]
  );

  await logAudit({
    userId: user.id,
    action: 'REPORT_GENERATED',
    entityType: 'generated_report',
    entityId: result.rows[0].id,
    metadata: {
      report_type: data.report_type,
      report_name: reportName,
      format: data.format,
    },
    ipAddress,
  });

  return {
    id: Number(result.rows[0].id),
    report_type: data.report_type,
    report_name: reportName,
    data: reportData,
    format: data.format,
    generated_at: result.rows[0].created_at,
    expires_at: result.rows[0].expires_at,
  };
}

// ============================================================
// REPORT HISTORY
// ============================================================

async function getReportHistory(user, filters = {}) {
  const ownerId = getOwnerScope(user);
  const conditions = [];
  const params = [];

  if (ownerId) {
    params.push(ownerId);
    conditions.push(`owner_id = $${params.length}`);
  }

  if (filters.report_type) {
    params.push(filters.report_type);
    conditions.push(`report_type = $${params.length}`);
  }

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }

  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const result = await db.query(
    `
    SELECT
      r.*,
      CONCAT(u.first_name, ' ', u.last_name) AS generated_by_name
    FROM generated_reports r
    LEFT JOIN users u ON u.id = r.generated_by
    WHERE ${conditions.join(' AND ')}
    ORDER BY r.created_at DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
    `,
    [...params, limit, offset]
  );

  const countResult = await db.query(
    `
    SELECT COUNT(*) AS total
    FROM generated_reports
    WHERE ${conditions.join(' AND ')}
    `,
    params
  );

  return {
    reports: result.rows.map((row) => ({
      id: Number(row.id),
      report_type: row.report_type,
      report_name: row.report_name,
      filters: row.filters,
      status: row.status,
      file_size: row.file_size,
      generated_by: row.generated_by ? Number(row.generated_by) : null,
      generated_by_name: row.generated_by_name,
      downloaded_at: row.downloaded_at,
      expires_at: row.expires_at,
      created_at: row.created_at,
    })),
    pagination: {
      total: Number(countResult.rows[0].total || 0),
      limit,
      offset,
      has_more: offset + limit < Number(countResult.rows[0].total || 0),
    },
  };
}

module.exports = {
  getOccupancyReport,
  getArrearsReport,
  getRentCollectionReport,
  getWaterBillingReport,
  getSmsUsageReport,
  getTenantStatement,
  generateExport,
  getReportHistory,
  formatMoney,
  formatDate,
};