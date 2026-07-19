const express = require('express');
const unitController = require('../controllers/unit_controller');
const { authenticate } = require('../middleware/auth_middleware');
const { requireRole } = require('../middleware/role_middleware');

const router = express.Router();

router.use(authenticate);

router.get('/', requireRole('admin', 'owner', 'caretaker'), unitController.listUnits);
router.get('/:id', requireRole('admin', 'owner', 'caretaker'), unitController.getUnit);

router.post('/', requireRole('admin', 'owner'), unitController.createUnit);
router.patch('/:id', requireRole('admin', 'owner', 'caretaker'), unitController.updateUnit);
router.delete('/:id', requireRole('admin', 'owner'), unitController.archiveUnit);

module.exports = router;