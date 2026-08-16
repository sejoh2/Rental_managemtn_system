const payment_service = require("./payment_service");

const {
  manual_payment_schema,
  provider_payment_schema,
  match_payment_schema,
  search_tenants_schema,
} = require("./payment_validator");



/*
|--------------------------------------------------------------------------
| Validation Error Helper
|--------------------------------------------------------------------------
*/

function get_validation_error(error) {

  return (
    error.issues
      ? error.issues[0].message
      : error.message
  );

}
/*
|--------------------------------------------------------------------------
| Record Manual Payment
|--------------------------------------------------------------------------
*/

async function record_manual_payment(
  req,
  res,
  next
) {

  try {

    const data =
      manual_payment_schema.parse(
        req.body
      );


    const result =
      await payment_service.record_manual_payment(
        req.user,

        data,

        req.ip
      );


    return res.status(201).json({

      success:true,

      message:
        "Manual payment recorded successfully.",

      data: result,

    });


  } catch(error) {

    next(error);

  }

}



/*
|--------------------------------------------------------------------------
| Record Provider Payment
|--------------------------------------------------------------------------
*/

async function record_provider_payment(
  req,
  res,
  next
) {

  try {


    const data =
      provider_payment_schema.parse(
        req.body
      );



    const result =
      await payment_service.record_provider_payment(
        data,

        req.ip
      );



    return res.status(201).json({

      success:true,

      message:
        result.matched
          ? "Provider payment recorded and allocated successfully."
          : "Provider payment received and waiting for matching.",


      data: result,

    });



  } catch(error) {


    next(error);


  }

}
/*
|--------------------------------------------------------------------------
| List Tenant Payments
|--------------------------------------------------------------------------
*/

async function list_tenant_payments(
  req,
  res,
  next
) {

  try {


    const payments =
      await payment_service.list_tenant_payments(
        req.user,

        Number(
          req.params.tenant_id
        )
      );



    return res.status(200).json({

      success:true,

      data: payments,

    });



  } catch(error) {

    next(error);

  }

}



/*
|--------------------------------------------------------------------------
| Get Unmatched Payments
|--------------------------------------------------------------------------
*/

async function get_unmatched_payments(
  req,
  res,
  next
) {

  try {


    const payments =
      await payment_service.get_unmatched_payments(
        req.user
      );



    return res.status(200).json({

      success:true,

      data: payments,

    });



  } catch(error) {

    next(error);

  }

}



/*
|--------------------------------------------------------------------------
| Get Payment Details
|--------------------------------------------------------------------------
*/

async function get_payment_details(
  req,
  res,
  next
) {

  try {


    const payment =
      await payment_service.get_payment_by_id(
        req.user,

        Number(
          req.params.payment_id
        )
      );



    if (!payment) {

      return res.status(404).json({

        success:false,

        message:
          "Payment not found.",

      });

    }



    return res.status(200).json({

      success:true,

      data: payment,

    });



  } catch(error) {

    next(error);

  }

}
/*
|--------------------------------------------------------------------------
| Match Unmatched Payment
|--------------------------------------------------------------------------
*/

async function match_payment(
  req,
  res,
  next
) {

  try {


    const data =
      match_payment_schema.parse(
        req.body
      );



    const payment =
      await payment_service.match_unmatched_payment(
        req.user,

        Number(
          req.params.payment_id
        ),

        data,

        req.ip
      );



    return res.status(200).json({

      success:true,

      message:
        "Payment matched successfully.",

      data: payment,

    });



  } catch(error) {


    next(error);


  }

}



/*
|--------------------------------------------------------------------------
| Search Tenants For Matching
|--------------------------------------------------------------------------
*/

async function search_tenants_for_matching(
  req,
  res,
  next
) {

  try {


    const data =
      search_tenants_schema.parse(
        req.query
      );



    const tenants =
      await payment_service.search_tenants_for_matching(
        req.user,

        data.search
      );



    return res.status(200).json({

      success:true,

      data: tenants,

    });



  } catch(error) {


    next(error);


  }

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
  list_tenant_payments,

  get_unmatched_payments,

  get_payment_details,


  // Payment matching
  match_payment,

  search_tenants_for_matching,

};