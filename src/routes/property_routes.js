const express = require('express');
const propertyController = require('../controllers/property_controller');
const { authenticate } = require('../middleware/auth_middleware');
const { requireRole } = require('../middleware/role_middleware');

const router = express.Router();

router.use(authenticate);
router.use(requireRole('admin', 'owner'));

router.get('/', propertyController.listProperties);
router.get('/:id', propertyController.getProperty);
router.post('/', propertyController.createProperty);
router.patch('/:id', propertyController.updateProperty);
router.delete('/:id', propertyController.archiveProperty);

module.exports = router;