const express = require('express');
const expenseController = require('../controllers/expense_controller');
const { authenticate } = require('../middleware/auth_middleware');
const { requireRole } = require('../middleware/role_middleware');

const router = express.Router();

router.use(authenticate);

// Get categories (Caretaker can view)
router.get('/categories', requireRole('admin', 'owner', 'caretaker'), expenseController.getExpenseCategories);

// Stats (Caretaker can view)
router.get('/stats', requireRole('admin', 'owner', 'caretaker'), expenseController.getExpenseStats);

// Profit calculation (Only owner/admin can view financial reports)
router.get('/profit', requireRole('admin', 'owner'), expenseController.calculateProfit);

// Category stats by property (Only owner/admin - caretaker doesn't need this)
router.get('/properties/:id/categories', requireRole('admin', 'owner'), expenseController.getCategoryStats);

// Expense CRUD - Carataker can CREATE and LIST, but only owner/admin can UPDATE/DELETE
router.get('/', requireRole('admin', 'owner', 'caretaker'), expenseController.listExpenses);
router.post('/', requireRole('admin', 'owner', 'caretaker'), expenseController.createExpense);  // ✅ CARETAKER CAN CREATE
router.get('/:id', requireRole('admin', 'owner', 'caretaker'), expenseController.getExpense);
router.patch('/:id', requireRole('admin', 'owner'), expenseController.updateExpense);  // ❌ CARETAKER CANNOT UPDATE
router.delete('/:id', requireRole('admin', 'owner'), expenseController.deleteExpense);  // ❌ CARETAKER CANNOT DELETE

module.exports = router;