const express = require("express");

const {
  rateLimit: rate_limit,
} = require("express-rate-limit");


const auth_controller =
  require("./auth_controller");


const {
  authenticate,
} = require("./auth_middleware");


const {
  require_role,
} = require("../middleware/role_middleware");


const router = express.Router();

const otp_limiter = rate_limit({
    windowMs: 15 * 60 * 1000,

    max: 5,

    message: {
        success: false,
        error: "Too many OTP requests. Please try again later.",
    },
});

router.post(
    "/request-otp",
    otp_limiter,
    auth_controller.request_otp
);

router.post(
    "/verify-otp",
    auth_controller.verify_otp
);

router.post(
    "/refresh-token",
    auth_controller.refresh_token
);

router.post(
    "/logout",
    auth_controller.logout
);

router.get(
    "/me",
    authenticate,
    auth_controller.me
);

router.get(
    "/admin-only-test",
    authenticate,
    require_role("admin"),
    (req, res) => {
        return res.json({
            success: true,
            message: "Admin access confirmed",
        });
    }
);

router.get(
    "/owner-only-test",
    authenticate,
    require_role("owner"),
    (req, res) => {
        return res.json({
            success: true,
            message: "Owner access confirmed",
        });
    }
);

router.get(
    "/caretaker-only-test",
    authenticate,
    require_role("caretaker"),
    (req, res) => {
        return res.json({
            success: true,
            message: "Caretaker access confirmed",
        });
    }
);

router.get(
    "/user-only-test",
    authenticate,
    require_role("user"),
    (req, res) => {
        return res.json({
            success: true,
            message: "User access confirmed",
        });
    }
);

module.exports = router;