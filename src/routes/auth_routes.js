const express = require('express');
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/auth_controller');
const { authenticate } = require('../middleware/auth_middleware');
const { requireRole } = require('../middleware/role_middleware');

const router = express.Router();

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    error: 'Too many OTP requests. Please try again later.',
  },
});

router.post('/request-otp', otpLimiter, authController.requestOtp);
router.post('/verify-otp', authController.verifyOtp);
router.post('/refresh-token', authController.refreshToken);
router.post('/logout', authController.logout);
router.get('/me', authenticate, authController.me);

router.get('/admin-only-test', authenticate, requireRole('admin'), (req, res) => {
  res.json({
    success: true,
    message: 'Admin access confirmed',
  });
});

router.get('/owner-only-test', authenticate, requireRole('owner'), (req, res) => {
  res.json({
    success: true,
    message: 'Owner access confirmed',
  });
});

router.get('/caretaker-only-test', authenticate, requireRole('caretaker'), (req, res) => {
  res.json({
    success: true,
    message: 'Caretaker access confirmed',
  });
});

router.get('/user-only-test', authenticate, requireRole('user'), (req, res) => {
  res.json({
    success: true,
    message: 'User access confirmed',
  });
});

module.exports = router;