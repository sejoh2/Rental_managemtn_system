const express = require('express');
const agreementController = require('../controllers/agreement_controller');
const { authenticate } = require('../middleware/auth_middleware');
const { requireRole } = require('../middleware/role_middleware');

const router = express.Router();

router.use(authenticate);

router.get('/templates', requireRole('admin', 'owner'), agreementController.listTemplates);
router.post('/templates', requireRole('admin', 'owner'), agreementController.saveTemplate);

module.exports = router;