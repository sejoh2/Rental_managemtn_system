const db = require("../config/db");
const { log_audit } = require("../audit/audit_service");

const PROPERTY_TYPE_LABELS = {
  apartment_block: "Apartment",
  bedsitters: "Bedsitters",
  mixed_use: "Mixed use",
  single_rooms: "Single rooms",
};

function format_money_short(amount) {
  const value = Number(amount || 0);

  if (value >= 1000000) {
    return `KES ${(value / 1000000).toFixed(1)}M`;
  }

  if (value >= 1000) {
    return `KES ${Math.round(value / 1000)}K`;
  }

  return `KES ${value.toLocaleString("en-KE")}`;
}

function public_property(row) {
  return {
    id: Number(row.id),
    owner_id: Number(row.owner_id),

    name: row.name,
    location: row.location,

    property_type: row.property_type,
    type:
      PROPERTY_TYPE_LABELS[row.property_type] ||
      row.property_type,

    expected_units: Number(
      row.expected_units || 0
    ),

    units: Number(
      row.units_count || 0
    ),

    occupied: Number(
      row.occupied_units || 0
    ),

    collected: format_money_short(
      row.collected_this_month
    ),

    rent_due_day: row.rent_due_day,

    water_billing_method:
      row.water_billing_method,

    water_rate_per_unit: Number(
      row.water_rate_per_unit || 0
    ),

    water_fixed_fee: Number(
      row.water_fixed_fee || 0
    ),

    water_billing_day:
      row.water_billing_day,

    water_reading_due_days:
      Number(
        row.water_reading_due_days || 0
      ),

    water_missed_reading_action:
      row.water_missed_reading_action,

    sms_sender_id:
      row.sms_sender_id,

    status: row.status,

    caretaker: row.caretaker_id
      ? {
          id: Number(row.caretaker_id),
          name: `${row.caretaker_first_name || ""} ${row.caretaker_last_name || ""}`.trim(),
          phone: row.caretaker_phone,
        }
      : null,

    payment_accounts: {
      rent: row.rent_account_id
        ? {
            id: Number(
              row.rent_account_id
            ),

            provider_code:
              row.rent_provider_code,

            account_type:
              row.rent_account_type,

            display_name:
              row.rent_display_name,

            account_name:
              row.rent_account_name,

            label:
              row.rent_label,

            business_number:
              row.rent_business_number,

            till_number:
              row.rent_till_number,

            account_number:
              row.rent_account_number,

            connection_status:
              row.rent_connection_status,
          }
        : null,

      water: row.water_account_id
        ? {
            id: Number(
              row.water_account_id
            ),

            provider_code:
              row.water_provider_code,

            account_type:
              row.water_account_type,

            display_name:
              row.water_display_name,

            account_name:
              row.water_account_name,

            label:
              row.water_label,

            business_number:
              row.water_business_number,

            till_number:
              row.water_till_number,

            account_number:
              row.water_account_number,

            connection_status:
              row.water_connection_status,
          }
        : null,
    },

    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function get_owner_scope(user) {
  if (user.role === "admin") {
    return null;
  }

  return user.user_id;
}
function base_property_select(where_clause) {
  return `
    SELECT
      p.*,

      caretaker.first_name AS caretaker_first_name,
      caretaker.last_name AS caretaker_last_name,
      caretaker.phone AS caretaker_phone,

      rent_account.id AS rent_account_id,
      rent_account.provider_code AS rent_provider_code,
      rent_account.account_type AS rent_account_type,
      rent_account.display_name AS rent_display_name,
      rent_account.account_name AS rent_account_name,
      rent_account.label AS rent_label,
      rent_account.business_number AS rent_business_number,
      rent_account.till_number AS rent_till_number,
      rent_account.account_number AS rent_account_number,
      rent_account.connection_status AS rent_connection_status,

      water_account.id AS water_account_id,
      water_account.provider_code AS water_provider_code,
      water_account.account_type AS water_account_type,
      water_account.display_name AS water_display_name,
      water_account.account_name AS water_account_name,
      water_account.label AS water_label,
      water_account.business_number AS water_business_number,
      water_account.till_number AS water_till_number,
      water_account.account_number AS water_account_number,
      water_account.connection_status AS water_connection_status,

      0::INTEGER AS units_count,
      0::INTEGER AS occupied_units,
      0::NUMERIC AS collected_this_month

    FROM properties p

    LEFT JOIN users caretaker
       ON caretaker.user_id = p.caretaker_id

    LEFT JOIN payment_accounts rent_account
      ON rent_account.property_id = p.id
      AND rent_account.account_for = 'rent'
      AND rent_account.status = 'active'

    LEFT JOIN payment_accounts water_account
      ON water_account.property_id = p.id
      AND water_account.account_for = 'water'
      AND water_account.status = 'active'

    ${where_clause}
  `;
}

async function validate_caretaker(owner_id, caretaker_id) {
  if (!caretaker_id) {
    return null;
  }

  const result = await db.query(
    `
    SELECT user_id
    FROM users
    WHERE user_id = $1
      AND owner_id = $2
      AND role = 'caretaker'
      AND status = 'active'
    `,
    [caretaker_id, owner_id]
  );

  if (!result.rows.length) {
    throw new Error(
      "Selected caretaker does not belong to this owner."
    );
  }

  return caretaker_id;
}
function normalize_payment_account(account, account_for) {
  if (!account) {
    return null;
  }

  const has_account_details =
    account.provider_code ||
    account.display_name ||
    account.business_number ||
    account.till_number ||
    account.account_number ||
    account.account_name;

  if (!has_account_details) {
    return null;
  }

  return {
    provider_code: account.provider_code,

    account_type: account.account_type,

    display_name:
      account.display_name || null,

    account_name:
      account.account_name || null,

    label:
      account.label ||
      `${account_for === "rent" ? "Rent" : "Water"} Account`,

    business_number:
      account.business_number || null,

    till_number:
      account.till_number || null,

    account_number:
      account.account_number || null,
  };
}

async function upsert_payment_account(
  client,
  {
    owner_id,
    property_id,
    account_for,
    account,
  }
) {
  const normalized =
    normalize_payment_account(
      account,
      account_for
    );

  if (!normalized) {
    return;
  }

  await client.query(
    `
    UPDATE payment_accounts
    SET
      status = 'inactive'
    WHERE property_id = $1
      AND account_for = $2
      AND status = 'active'
    `,
    [
      property_id,
      account_for,
    ]
  );

  await client.query(
    `
    INSERT INTO payment_accounts (
      owner_id,
      property_id,
      account_for,
      provider_code,
      account_type,
      display_name,
      account_name,
      label,
      business_number,
      till_number,
      account_number
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
    )
    `,
    [
      owner_id,
      property_id,
      account_for,

      normalized.provider_code,
      normalized.account_type,
      normalized.display_name,
      normalized.account_name,
      normalized.label,
      normalized.business_number,
      normalized.till_number,
      normalized.account_number,
    ]
  );
}
async function list_properties(user) {
  const owner_id = get_owner_scope(user);

  const result = owner_id
    ? await db.query(
        `
        ${base_property_select(
          "WHERE p.owner_id = $1 AND p.status = $2"
        )}
        ORDER BY p.created_at DESC
        `,
        [owner_id, "active"]
      )
    : await db.query(
        `
        ${base_property_select(
          "WHERE p.status = $1"
        )}
        ORDER BY p.created_at DESC
        `,
        ["active"]
      );

  return result.rows.map(public_property);
}

async function get_property_by_id(
  user,
  property_id
) {
  const owner_id = get_owner_scope(user);

  const result = owner_id
    ? await db.query(
        `
        ${base_property_select(
          "WHERE p.id = $1 AND p.owner_id = $2"
        )}
        LIMIT 1
        `,
        [
          property_id,
          owner_id,
        ]
      )
    : await db.query(
        `
        ${base_property_select(
          "WHERE p.id = $1"
        )}
        LIMIT 1
        `,
        [property_id]
      );

  if (!result.rows.length) {
    return null;
  }

  return public_property(result.rows[0]);
}
async function create_property(
  user,
  data,
  ip_address
) {
  if (
    user.role !== "owner" &&
    user.role !== "admin"
  ) {
    throw new Error(
      "Only property owners can create properties."
    );
  }

  const owner_id = user.user_id;

  const caretaker_id =
    await validate_caretaker(
      owner_id,
      data.caretaker_id
    );

  const client = await db.getClient();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `
      INSERT INTO properties (
        owner_id,
        caretaker_id,
        created_by,

        name,
        location,
        property_type,
        expected_units,

        rent_due_day,

        water_billing_method,
        water_rate_per_unit,
        water_fixed_fee,
        water_billing_day,
        water_reading_due_days,
        water_missed_reading_action,

        sms_sender_id
      )
      VALUES (
        $1,$2,$3,
        $4,$5,$6,$7,
        $8,
        $9,$10,$11,$12,$13,$14,
        $15
      )
      RETURNING id
      `,
      [
        owner_id,
        caretaker_id,
        user.user_id,

        data.name,
        data.location,
        data.property_type,
        data.expected_units || 0,

        data.rent_due_day,

        data.water_billing_method,
        data.water_rate_per_unit,
        data.water_fixed_fee || 0,
        data.water_billing_day,
        data.water_reading_due_days,
        data.water_reading_due_days ?? 3,
        data.water_missed_reading_action ?? "carry_forward",

        data.sms_sender_id || null,
      ]
    );

    const property_id =
      result.rows[0].id;

    if (data.rent_account) {
      await upsert_payment_account(
        client,
        {
          owner_id,
          property_id,
          account_for: "rent",
          account: data.rent_account,
        }
      );
    }

    if (data.water_account) {
      await upsert_payment_account(
        client,
        {
          owner_id,
          property_id,
          account_for: "water",
          account: data.water_account,
        }
      );
    }

    await client.query("COMMIT");

    await log_audit({
      user_id: user.id,
      action: "PROPERTY_CREATED",
      entity_type: "property",
      entity_id: property_id,
      metadata: {
        property_name: data.name,
      },
      ip_address,
    });

    return await get_property_by_id(
      user,
      property_id
    );
  } catch (error) {
    await client.query("ROLLBACK");

    if (error.code === "23505") {
      throw new Error(
        "A property with the same name already exists."
      );
    }

    throw error;
  } finally {
    client.release();
  }
}
async function update_property(
  user,
  property_id,
  data,
  ip_address
) {
  const existing =
    await get_property_by_id(
      user,
      property_id
    );

  if (!existing) {
    throw new Error(
      "Property not found."
    );
  }

  const owner_id = existing.owner_id;

  const caretaker_id =
    Object.prototype.hasOwnProperty.call(
      data,
      "caretaker_id"
    )
      ? await validate_caretaker(
          owner_id,
          data.caretaker_id
        )
      : existing.caretaker?.id || null;

  const client = await db.getClient();

  try {
    await client.query("BEGIN");

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

        water_billing_method =
          COALESCE($7, water_billing_method),

        water_rate_per_unit =
          COALESCE($8, water_rate_per_unit),

        water_fixed_fee =
          COALESCE($9, water_fixed_fee),

        water_billing_day =
          COALESCE($10, water_billing_day),

        water_reading_due_days =
          COALESCE(
            $11,
            water_reading_due_days
          ),

        water_missed_reading_action =
          COALESCE(
            $12,
            water_missed_reading_action
          ),

        sms_sender_id =
          COALESCE(
            $13,
            sms_sender_id
          )

      WHERE id = $14
        AND owner_id = $15
      `,
      [
        caretaker_id,

        data.name ?? null,
        data.location ?? null,
        data.property_type ?? null,
        data.expected_units ?? null,

        data.rent_due_day ?? null,

        data.water_billing_method ?? null,
        data.water_rate_per_unit ?? null,
        data.water_fixed_fee ?? null,
        data.water_billing_day ?? null,
        data.water_reading_due_days ?? null,
        data.water_missed_reading_action ?? null,

        data.sms_sender_id ?? null,

        property_id,
        owner_id,
      ]
    );

    if (
      Object.prototype.hasOwnProperty.call(
        data,
        "rent_account"
      )
    ) {
      await upsert_payment_account(
        client,
        {
          owner_id,
          property_id,
          account_for: "rent",
          account: data.rent_account,
        }
      );
    }

    if (
      Object.prototype.hasOwnProperty.call(
        data,
        "water_account"
      )
    ) {
      await upsert_payment_account(
        client,
        {
          owner_id,
          property_id,
          account_for: "water",
          account: data.water_account,
        }
      );
    }

    await client.query("COMMIT");

    await log_audit({
      user_id: user.id,
      action: "PROPERTY_UPDATED",
      entity_type: "property",
      entity_id: property_id,
      metadata: data,
      ip_address,
    });

    return await get_property_by_id(
      user,
      property_id
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function archive_property(
  user,
  property_id,
  ip_address
) {
  const existing =
    await get_property_by_id(
      user,
      property_id
    );

  if (!existing) {
    throw new Error(
      "Property not found."
    );
  }

  const owner_id = existing.owner_id;

  const client = await db.getClient();

  try {
    await client.query("BEGIN");

    await client.query(
      `
      UPDATE properties
      SET
        status = 'archived'
      WHERE id = $1
        AND owner_id = $2
      `,
      [
        property_id,
        owner_id,
      ]
    );

    await client.query(
      `
      UPDATE payment_accounts
      SET
        status = 'inactive'
      WHERE property_id = $1
        AND status = 'active'
      `,
      [property_id]
    );

    await client.query("COMMIT");

    await log_audit({
      user_id: user.id,
      action: "PROPERTY_ARCHIVED",
      entity_type: "property",
      entity_id: property_id,
      metadata: {
        property_name: existing.name,
      },
      ip_address,
    });

    return {
      success: true,
      message:
        "Property archived successfully.",
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
module.exports = {
  list_properties,
  get_property_by_id,
  create_property,
  update_property,
  archive_property,
};