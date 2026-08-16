const express = require("express");

const property_controller = require("./property_controller");

const {
  authenticate,
} = require("../auth/auth_middleware");

const {
  require_role,
} = require("../middleware/role_middleware");

const router = express.Router();

router.use(authenticate);

router.use(
  require_role(
    "admin",
    "owner"
  )
); 
router.get(
  "/",
  property_controller.list_properties
);

router.get(
  "/:property_id",
  property_controller.get_property
);

router.post(
  "/",
  property_controller.create_property
);

router.patch(
  "/:property_id",
  property_controller.update_property
);

router.delete(
  "/:property_id",
  property_controller.archive_property
);

module.exports = router;