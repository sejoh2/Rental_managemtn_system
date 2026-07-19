const express = require('express');
const caretakerController = require('../controllers/caretaker_controller');
const { authenticate } = require('../middleware/auth_middleware');
const { requireRole } = require('../middleware/role_middleware');

const router = express.Router();

router.use(authenticate);

// Only owners and admins can manage caretakers
router.use(requireRole('admin', 'owner'));

// Permission levels
router.get('/permission-levels', caretakerController.getPermissionLevels);

// Available properties for assignment
router.get('/properties', caretakerController.getAvailableProperties);

// Caretaker activity
router.get('/:id/activity', caretakerController.getCaretakerActivity);

// CRUD
router.get('/', caretakerController.listCaretakers);
router.post('/', caretakerController.createCaretaker);
router.get('/:id', caretakerController.getCaretaker);
router.patch('/:id', caretakerController.updateCaretaker);
router.delete('/:id', caretakerController.deleteCaretaker);

module.exports = router;