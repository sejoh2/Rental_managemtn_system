const express = require("express");

const payment_controller =
  require("./payment_controller");


const {
  authenticate,
} = require("../auth/auth_middleware");


const {
  require_role,
} = require("../middleware/role_middleware");


const router = express.Router();



/*
|--------------------------------------------------------------------------
| Authentication
|--------------------------------------------------------------------------
*/

router.use(
  authenticate
);



/*
|--------------------------------------------------------------------------
| Payment Routes
|--------------------------------------------------------------------------
*/


/*
|--------------------------------------------------------------------------
| Get unmatched payments
|--------------------------------------------------------------------------
|
| Used by owners/admins to see provider payments
| that need manual matching.
|
*/

router.get(
  "/unmatched",
  require_role(
    "admin",
    "owner",
    "caretaker"
  ),
  payment_controller.get_unmatched_payments
);



/*
|--------------------------------------------------------------------------
| Search tenants for matching
|--------------------------------------------------------------------------
|
| Used when manually attaching an unmatched
| payment to a tenant.
|
*/

router.get(
  "/search-tenants",
  require_role(
    "admin",
    "owner"
  ),
  payment_controller.search_tenants_for_matching
);



/*
|--------------------------------------------------------------------------
| Record manual payment
|--------------------------------------------------------------------------
|
| Owner/admin records a payment manually.
|
*/

router.post(
  "/manual",
  require_role(
    "admin",
    "owner",
    "caretaker"
  ),
  payment_controller.record_manual_payment
);



/*
|--------------------------------------------------------------------------
| Provider payment webhook
|--------------------------------------------------------------------------
|
| Receives payments from providers:
|
| - mpesa
| - equity
| - kcb
| - stripe
| etc.
|
*/

router.post(
  "/provider",
  require_role(
    "admin",
    "owner",
    "caretaker"
  ),
  payment_controller.record_provider_payment
);



/*
|--------------------------------------------------------------------------
| Match unmatched payment
|--------------------------------------------------------------------------
*/

router.post(
  "/:payment_id/match",
  require_role(
    "admin",
    "owner"
  ),
  payment_controller.match_payment
);



/*
|--------------------------------------------------------------------------
| Tenant payment history
|--------------------------------------------------------------------------
*/

router.get(
  "/tenant/:tenant_id",
  require_role(
    "admin",
    "owner",
    "caretaker"
  ),
  payment_controller.list_tenant_payments
);



/*
|--------------------------------------------------------------------------
| Payment details
|--------------------------------------------------------------------------
*/

router.get(
  "/:payment_id",
  require_role(
    "admin",
    "owner",
    "caretaker"
  ),
  payment_controller.get_payment_details
);



module.exports = router;