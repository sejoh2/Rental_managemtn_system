const db = require("../config/db");

const {
  log_audit,
} = require("../services/audit_service");


/*
|--------------------------------------------------------------------------
| Get owner scope
|--------------------------------------------------------------------------
|
| Owners and admins should see their own data.
| Super admins can see everything.
|
*/
function get_owner_scope(user) {

  if (
    user.role === "admin"
  ) {
    return null;
  }


  return user.id;
}



/*
|--------------------------------------------------------------------------
| Format payment response
|--------------------------------------------------------------------------
*/

function public_payment(payment) {

  if (!payment) {
    return null;
  }


  return {
    id: Number(payment.id),

    owner_id:
      Number(payment.owner_id),

    property_id:
      payment.property_id
        ? Number(payment.property_id)
        : null,

    unit_id:
      payment.unit_id
        ? Number(payment.unit_id)
        : null,

    tenant_id:
      payment.tenant_id
        ? Number(payment.tenant_id)
        : null,


    amount:
      Number(payment.amount || 0),


    payment_method:
      payment.payment_method,


    payment_source:
      payment.payment_source,


    apply_to:
      payment.apply_to,


    provider_code:
      payment.provider_code,


    provider_transaction_id:
      payment.provider_transaction_id,


    status:
      payment.status,


    reference:
      payment.reference,


    received_at:
      payment.received_at,


    created_at:
      payment.created_at,
  };
}
/*
|--------------------------------------------------------------------------
| Get tenant
|--------------------------------------------------------------------------
*/

async function get_tenant(
  user,
  tenant_id
) {

  const owner_id =
    get_owner_scope(user);


  const query = `
    SELECT
      t.*,

      p.name AS property_name,

      u.unit_number

    FROM tenants t

    LEFT JOIN properties p
      ON p.id = t.property_id

    LEFT JOIN units u
      ON u.id = t.unit_id

    WHERE t.id = $1

    ${
      owner_id
        ? "AND t.owner_id = $2"
        : ""
    }

    LIMIT 1
  `;


  const values =
    owner_id
      ? [
          tenant_id,
          owner_id,
        ]
      : [
          tenant_id,
        ];


  const result =
    await db.query(
      query,
      values
    );


  const tenant =
    result.rows[0];


  if (!tenant) {
    throw new Error(
      "Tenant not found."
    );
  }


  return tenant;
}



/*
|--------------------------------------------------------------------------
| Base payment query
|--------------------------------------------------------------------------
*/

function base_payment_select() {

  return `
    SELECT

      pay.*,

      p.name AS property_name,

      u.unit_number,

      t.full_name AS tenant_name,

      t.phone AS tenant_phone

    FROM payments pay

    LEFT JOIN properties p
      ON p.id = pay.property_id

    LEFT JOIN units u
      ON u.id = pay.unit_id

    LEFT JOIN tenants t
      ON t.id = pay.tenant_id
  `;
}



/*
|--------------------------------------------------------------------------
| Create payment record
|--------------------------------------------------------------------------
*/

async function create_payment_record(
  client,
  data
) {

  const result =
    await client.query(
      `
      INSERT INTO payments (

        owner_id,

        property_id,

        unit_id,

        tenant_id,

        payment_account_id,

        amount,

        payment_method,

        apply_to,

        payment_source,

        provider_code,

        provider_transaction_id,

        business_number,

        bill_ref_number,

        provider_payload,

        phone,

        reference,

        notes,

        received_at,

        status,

        recorded_by

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
        $12,
        $13,
        $14,
        $15,
        $16,
        $17,
        COALESCE($18, CURRENT_TIMESTAMP),
        $19,
        $20

      )

      RETURNING *
      `,
      [

        data.owner_id,

        data.property_id || null,

        data.unit_id || null,

        data.tenant_id || null,

        data.payment_account_id || null,

        data.amount,

        data.payment_method,

        data.apply_to ||
          "rent_balance",

        data.payment_source ||
          "manual",

        data.provider_code ||
          null,

        data.provider_transaction_id ||
          null,

        data.business_number ||
          null,

        data.bill_ref_number ||
          null,

        data.provider_payload ||
          null,

        data.phone ||
          null,

        data.reference ||
          null,

        data.notes ||
          null,

        data.received_at ||
          null,

        data.status ||
          "matched",

        data.recorded_by ||
          null,

      ]
    );


  return result.rows[0];
}
/*
|--------------------------------------------------------------------------
| Create unmatched payment
|--------------------------------------------------------------------------
*/

async function create_unmatched_payment(
  client,
  data
) {

  const payment =
    await create_payment_record(
      client,
      {
        ...data,

        tenant_id:
          null,

        property_id:
          data.property_id ||
          null,

        unit_id:
          null,

        status:
          "unmatched",

        payment_source:
          "provider",
      }
    );


  return payment;
}



/*
|--------------------------------------------------------------------------
| Apply payment to water bill
|--------------------------------------------------------------------------
*/

async function apply_to_water_bill(
  client,
  tenant_id,
  amount
) {

  let remaining =
    Number(amount);


  if (remaining <= 0) {
    return {
      applied: 0,
      remaining: 0,
    };
  }



  /*
  |--------------------------------------------------------------------------
  | Get outstanding water bills
  |--------------------------------------------------------------------------
  */

  const bills =
    await client.query(
      `
      SELECT

        id,

        amount_due,

        amount_paid

      FROM water_bills

      WHERE tenant_id = $1

      AND status != 'paid'

      ORDER BY created_at ASC

      FOR UPDATE
      `,
      [
        tenant_id,
      ]
    );



  let applied = 0;



  for (
    const bill of bills.rows
  ) {

    if (remaining <= 0) {
      break;
    }


    const balance =
      Number(
        bill.amount_due
      ) -
      Number(
        bill.amount_paid || 0
      );


    if (balance <= 0) {
      continue;
    }



    const allocation =
      Math.min(
        remaining,
        balance
      );



    await client.query(
      `
      UPDATE water_bills

      SET

        amount_paid =
          amount_paid + $1,

        status =
          CASE

            WHEN amount_paid + $1 >= amount_due

            THEN 'paid'

            ELSE 'partial'

          END

      WHERE id = $2
      `,
      [
        allocation,
        bill.id,
      ]
    );



    remaining -= allocation;

    applied += allocation;
  }



  return {
    applied,

    remaining,
  };
}
/*
|--------------------------------------------------------------------------
| Allocate Payment
|--------------------------------------------------------------------------
*/

async function allocate_payment(
  client,
  {
    tenant,
    amount,
    apply_to = "rent_balance",
    payment_data,
    should_create_payment = true,
  }
) {

  let remaining =
    Number(amount);


  let rent_deposit_applied = 0;

  let water_deposit_applied = 0;

  let water_bill_applied = 0;

  let rent_balance_applied = 0;



  /*
  |--------------------------------------------------------------------------
  | Step 1 - Rent Deposit
  |--------------------------------------------------------------------------
  */

  if (
    (
      apply_to === "rent_deposit" ||
      apply_to === "deposit"
    )
    &&
    remaining > 0
  ) {


    const required =
      Math.max(
        Number(
          tenant.rent_deposit_amount || 0
        )
        -
        Number(
          tenant.rent_deposit_paid || 0
        ),
        0
      );


    const allocation =
      Math.min(
        remaining,
        required
      );


    if (allocation > 0) {

      await client.query(
        `
        UPDATE tenants

        SET rent_deposit_paid =
          COALESCE(
            rent_deposit_paid,
            0
          )
          + $1

        WHERE id = $2
        `,
        [
          allocation,
          tenant.id,
        ]
      );


      remaining -= allocation;

      rent_deposit_applied =
        allocation;
    }
  }



  /*
  |--------------------------------------------------------------------------
  | Step 2 - Water Deposit
  |--------------------------------------------------------------------------
  */

  if (
    (
      apply_to === "water_deposit" ||
      apply_to === "deposit"
    )
    &&
    remaining > 0
  ) {


    const required =
      Math.max(
        Number(
          tenant.water_deposit_amount || 0
        )
        -
        Number(
          tenant.water_deposit_paid || 0
        ),
        0
      );


    const allocation =
      Math.min(
        remaining,
        required
      );


    if (allocation > 0) {

      await client.query(
        `
        UPDATE tenants

        SET water_deposit_paid =
          COALESCE(
            water_deposit_paid,
            0
          )
          + $1

        WHERE id = $2
        `,
        [
          allocation,
          tenant.id,
        ]
      );


      remaining -= allocation;

      water_deposit_applied =
        allocation;
    }
  }



  /*
  |--------------------------------------------------------------------------
  | Step 3 - Water Bills
  |--------------------------------------------------------------------------
  */

  if (
    (
      apply_to === "water_bill" ||
      apply_to === "rent_balance"
    )
    &&
    remaining > 0
  ) {

    const result =
      await apply_to_water_bill(
        client,
        tenant.id,
        remaining
      );


    water_bill_applied =
      result.applied;


    remaining =
      result.remaining;
  }



  /*
  |--------------------------------------------------------------------------
  | Step 4 - Rent Balance
  |--------------------------------------------------------------------------
  */

  if (
    apply_to === "rent_balance"
    &&
    remaining > 0
  ) {


    await client.query(
      `
      UPDATE tenants

      SET rent_balance =
        COALESCE(
          rent_balance,
          0
        )
        - $1

      WHERE id = $2
      `,
      [
        remaining,
        tenant.id,
      ]
    );


    rent_balance_applied =
      remaining;


    remaining = 0;
  }



  /*
  |--------------------------------------------------------------------------
  | Step 5 - Remaining Credit
  |--------------------------------------------------------------------------
  */

  if (
    remaining > 0
  ) {

    await client.query(
      `
      UPDATE tenants

      SET credit_balance =
        COALESCE(
          credit_balance,
          0
        )
        + $1

      WHERE id = $2
      `,
      [
        remaining,
        tenant.id,
      ]
    );
  }



  /*
  |--------------------------------------------------------------------------
  | Create payment record
  |--------------------------------------------------------------------------
  */

  let payment = null;


if (should_create_payment) {

    payment =
      await create_payment_record(
        client,
        {
        ...payment_data,

        tenant_id:
          tenant.id,

        property_id:
          tenant.property_id,

        unit_id:
          tenant.unit_id,

        amount,

        status:
          "matched",
      }
    );

}



  return {

    payment,

    allocation: {

      rent_deposit_applied,

      water_deposit_applied,

      water_bill_applied,

      rent_balance_applied,

      credit_applied:
        remaining,
    },
  };
}
/*
|--------------------------------------------------------------------------
| Record Manual Payment
|--------------------------------------------------------------------------
*/

async function record_manual_payment(
  user,
  data,
  ip
) {

  const tenant =
    await get_tenant(
      user,
      data.tenant_id
    );


  const client =
    await db.get_client();


  try {

    await client.query(
      "BEGIN"
    );


    const result =
      await allocate_payment(
        client,
        {
          tenant,

          amount:
            Number(data.amount),

          apply_to:
            data.apply_to ||
            "rent_balance",

          payment_data: {

            owner_id:
              tenant.owner_id,

            payment_method:
              data.payment_method ||
              "cash",

            payment_source:
              "manual",

            phone:
              data.phone ||
              tenant.phone,

            reference:
              data.reference,

            notes:
              data.notes,

            received_at:
              data.received_at,

            recorded_by:
              user.id,
          },
        }
      );


    await log_audit({

      user_id:
        user.id,

      action:
        "manual_payment_recorded",

      entity_type:
        "payment",

      entity_id:
        result.payment.id,

      metadata: {

        tenant_id:
          tenant.id,

        amount:
          data.amount,

        payment_method:
          data.payment_method,

      },

      ip_address:
        ip,

    });



    await client.query(
      "COMMIT"
    );


    return {

      payment:
        public_payment(
          result.payment
        ),

      allocation:
        result.allocation,

    };


  } catch(error) {


    await client.query(
      "ROLLBACK"
    );


    throw error;


  } finally {

    client.release();

  }
}



/*
|--------------------------------------------------------------------------
| Record Provider Payment
|--------------------------------------------------------------------------
*/

async function record_provider_payment(
  data,
  ip
) {


  const client =
    await db.get_client();



  try {


    await client.query(
      "BEGIN"
    );

    /*
|--------------------------------------------------------------------------
| Prevent duplicate provider payments
|--------------------------------------------------------------------------
*/

if (
  data.provider_code &&
  data.provider_transaction_id
) {

  const existing =
    await client.query(
      `
      SELECT id

      FROM payments

      WHERE provider_code = $1

      AND provider_transaction_id = $2

      LIMIT 1
      `,
      [
        data.provider_code,

        data.provider_transaction_id,
      ]
    );


  if (
    existing.rows.length > 0
  ) {

    await client.query(
      "COMMIT"
    );


   const existing_payment =
  await db.query(
    `
    ${base_payment_select()}

    WHERE pay.id = $1

    LIMIT 1
    `,
    [
      existing.rows[0].id,
    ]
  );


return {
  payment:
    public_payment(
      existing_payment.rows[0]
    ),

  duplicate:true,
};

  }

}



    /*
    |--------------------------------------------------------------------------
    | If tenant cannot be identified
    |--------------------------------------------------------------------------
    */

    if (
      !data.tenant_id
    ) {


      const unmatched =
        await create_unmatched_payment(
          client,
          {

            ...data,

            payment_source:
              "provider",

          }
        );



      await client.query(
        "COMMIT"
      );


      return {

        payment:
          public_payment(
            unmatched
          ),

        matched:
          false,

      };
    }



   const tenant =
      await get_tenant(
        {
          id:
            data.owner_id,

          role:
            "admin",

        },
        data.tenant_id
      );



    const result =
      await allocate_payment(
        client,
        {

          tenant,

          amount:
            Number(
              data.amount
            ),

          apply_to:
            data.apply_to ||
            "rent_balance",


          payment_data: {

            ...data,

            payment_source:
              "provider",

          },

        }
      );



    await log_audit({

      user_id:
        null,

      action:
        "provider_payment_received",

      entity_type:
        "payment",

      entity_id:
  result.payment
    ? result.payment.id
    : null,


      metadata: {

        provider:
          data.provider_code,

        transaction_id:
          data.provider_transaction_id,

      },


      ip_address:
        ip,

    });



    await client.query(
      "COMMIT"
    );



    return {

      payment:
        public_payment(
          result.payment
        ),

      allocation:
        result.allocation,

      matched:
        true,

    };



  } catch(error) {


    await client.query(
      "ROLLBACK"
    );


    throw error;


  } finally {

    client.release();

  }
}
/*
|--------------------------------------------------------------------------
| Get Payment By ID
|--------------------------------------------------------------------------
*/

async function get_payment_by_id(
  user,
  payment_id
) {

  const owner_id =
    get_owner_scope(user);


  const query = `
    ${base_payment_select()}

    WHERE pay.id = $1

    ${
      owner_id
        ? "AND pay.owner_id = $2"
        : ""
    }

    LIMIT 1
  `;


  const values =
    owner_id
      ? [
          payment_id,
          owner_id,
        ]
      : [
          payment_id,
        ];


  const result =
    await db.query(
      query,
      values
    );


  if (
    !result.rows[0]
  ) {
    return null;
  }


  return public_payment(
    result.rows[0]
  );
}



/*
|--------------------------------------------------------------------------
| Get Unmatched Payments
|--------------------------------------------------------------------------
*/

async function get_unmatched_payments(
  user
) {

  const owner_id =
    get_owner_scope(user);


  const query = `
    ${base_payment_select()}

    WHERE pay.status = 'unmatched'

    ${
      owner_id
        ? "AND pay.owner_id = $1"
        : ""
    }

    ORDER BY
      pay.created_at DESC
  `;


  const values =
    owner_id
      ? [
          owner_id,
        ]
      : [];


  const result =
    await db.query(
      query,
      values
    );


  return result.rows.map(
    public_payment
  );
}



/*
|--------------------------------------------------------------------------
| List Tenant Payments
|--------------------------------------------------------------------------
*/

async function list_tenant_payments(
  user,
  tenant_id
) {

  const tenant =
    await get_tenant(
      user,
      tenant_id
    );


  const result =
    await db.query(
      `
      ${base_payment_select()}

      WHERE pay.tenant_id = $1

      ORDER BY
        pay.received_at DESC
      `,
      [
        tenant.id,
      ]
    );


  return result.rows.map(
    public_payment
  );
}
/*
|--------------------------------------------------------------------------
| Match Unmatched Payment
|--------------------------------------------------------------------------
*/

async function match_unmatched_payment(
  user,
  payment_id,
  data,
  ip
) {

  const owner_id =
    get_owner_scope(user);


  /*
  |--------------------------------------------------------------------------
  | Find unmatched payment
  |--------------------------------------------------------------------------
  */

  const query = `
    ${base_payment_select()}

    WHERE pay.id = $1

    AND pay.status = 'unmatched'

    ${
      owner_id
        ? "AND pay.owner_id = $2"
        : ""
    }

    LIMIT 1
  `;


  const values =
    owner_id
      ? [
          payment_id,
          owner_id,
        ]
      : [
          payment_id,
        ];



  const payment_result =
    await db.query(
      query,
      values
    );


  const payment =
    payment_result.rows[0];



  if (!payment) {

    throw new Error(
      "Unmatched payment not found."
    );

  }



  const tenant =
    await get_tenant(
      user,
      data.tenant_id
    );



  const client =
    await db.get_client();



  try {


    await client.query(
      "BEGIN"
    );



    /*
    |--------------------------------------------------------------------------
    | Allocate payment
    |--------------------------------------------------------------------------
    */

    
      await allocate_payment(
        client,
        {
            tenant,

            should_create_payment: false,

          amount:
            Number(
              payment.amount
            ),


          apply_to:
            data.apply_to ||
            payment.apply_to ||
            "rent_balance",



          payment_data: {

            owner_id:
              payment.owner_id,


            payment_method:
              payment.payment_method,


            payment_source:
              payment.payment_source,


            provider_code:
              payment.provider_code,


            provider_transaction_id:
              payment.provider_transaction_id,


            business_number:
              payment.business_number,


            bill_ref_number:
              payment.bill_ref_number,


            provider_payload:
              payment.provider_payload,


            phone:
              payment.phone,


            reference:
              payment.reference,


            notes:
              data.notes ||
              payment.notes,


            received_at:
              payment.received_at,


            recorded_by:
              user.id,

          },

        }
      );



    /*
    |--------------------------------------------------------------------------
    | Update original payment
    |--------------------------------------------------------------------------
    */

    await client.query(
      `
      UPDATE payments

      SET

        tenant_id = $1,

        property_id = $2,

        unit_id = $3,

        status = 'matched',

        matched_by = $4,

        matched_at =
          CURRENT_TIMESTAMP

      WHERE id = $5
      `,
      [

        tenant.id,

        tenant.property_id,

        tenant.unit_id,

        user.id,

        payment_id,

      ]
    );



    await log_audit({

      user_id:
        user.id,


      action:
        "payment_matched",


      entity_type:
        "payment",


      entity_id:
        payment_id,


      metadata: {

        tenant_id:
          tenant.id,


        amount:
          payment.amount,


        provider:
          payment.provider_code,

      },


      ip_address:
        ip,

    });



    await client.query(
      "COMMIT"
    );



    return await get_payment_by_id(
      user,
      payment_id
    );



  } catch(error) {


    await client.query(
      "ROLLBACK"
    );


    throw error;



  } finally {


    client.release();


  }

}
/*
|--------------------------------------------------------------------------
| Search Tenants For Matching
|--------------------------------------------------------------------------
*/

async function search_tenants_for_matching(
  user,
  search
) {

  const owner_id =
    get_owner_scope(user);



  if (
    !search ||
    search.trim().length < 2
  ) {

    return [];

  }



  const keyword =
    `%${search.trim()}%`;



  const query = `
    SELECT

      t.id,

      t.full_name,

      t.phone,

      p.name AS property_name,

      u.unit_number


    FROM tenants t


    LEFT JOIN properties p
      ON p.id = t.property_id


    LEFT JOIN units u
      ON u.id = t.unit_id



    WHERE

      t.status != 'archived'


      ${
        owner_id
          ? "AND t.owner_id = $1"
          : ""
      }


      AND (

        t.full_name ILIKE ${
          owner_id
            ? "$2"
            : "$1"
        }


        OR t.phone ILIKE ${
          owner_id
            ? "$2"
            : "$1"
        }


        OR u.unit_number ILIKE ${
          owner_id
            ? "$2"
            : "$1"
        }

      )


    ORDER BY

      t.full_name ASC


    LIMIT 20
  `;



  const values =
    owner_id
      ? [
          owner_id,
          keyword,
        ]
      : [
          keyword,
        ];



  const result =
    await db.query(
      query,
      values
    );



  return result.rows.map(
    (tenant) => ({

      id:
        Number(
          tenant.id
        ),


      full_name:
        tenant.full_name,


      phone:
        tenant.phone,


      property_name:
        tenant.property_name,


      unit_number:
        tenant.unit_number,

    })
  );
}
/*
|--------------------------------------------------------------------------
| Exports
|--------------------------------------------------------------------------
*/

module.exports = {

  // Payment creation
  record_manual_payment,

  record_provider_payment,


  // Payment queries
  get_payment_by_id,

  get_unmatched_payments,

  list_tenant_payments,


  // Payment matching
  match_unmatched_payment,

  search_tenants_for_matching,

};