const expenseService = require('../services/expense_service');
const {
  createExpenseSchema,
  updateExpenseSchema,
  listExpensesQuerySchema,
  profitSummarySchema,
} = require('../validators/expense_validator');

function getValidationError(error) {
  return error.issues ? error.issues[0].message : error.message;
}

async function listExpenses(req, res) {
  try {
    const filters = listExpensesQuerySchema.parse(req.query);
    const result = await expenseService.listExpenses(req.user, filters);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

// ✅ CARETAKER CAN CREATE EXPENSES
async function createExpense(req, res) {
  try {
    const data = createExpenseSchema.parse(req.body);
    const expense = await expenseService.createExpense(req.user, data, req.ip);

    res.status(201).json({
      success: true,
      message: 'Expense added successfully',
      expense,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

// ✅ CARETAKER CAN VIEW EXPENSE DETAILS
async function getExpense(req, res) {
  try {
    const expense = await expenseService.getExpenseById(req.user, req.params.id);

    if (!expense) {
      return res.status(404).json({
        success: false,
        error: 'Expense not found',
      });
    }

    res.json({
      success: true,
      expense,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

// ❌ CARETAKER CANNOT UPDATE EXPENSES
async function updateExpense(req, res) {
  try {
    const data = updateExpenseSchema.parse(req.body);
    const expense = await expenseService.updateExpense(req.user, req.params.id, data, req.ip);

    res.json({
      success: true,
      message: 'Expense updated successfully',
      expense,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

// ❌ CARETAKER CANNOT DELETE EXPENSES
async function deleteExpense(req, res) {
  try {
    await expenseService.deleteExpense(req.user, req.params.id, req.ip);

    res.json({
      success: true,
      message: 'Expense deleted successfully',
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

// ✅ CARETAKER CAN VIEW CATEGORIES
async function getCategoryStats(req, res) {
  try {
    const propertyId = req.params.id;
    const stats = await expenseService.getCategoryStats(req.user, propertyId);

    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

// ✅ CARETAKER CAN VIEW CATEGORIES LIST
async function getExpenseCategories(req, res) {
  try {
    const categories = await expenseService.getExpenseCategories();

    res.json({
      success: true,
      categories,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

// ✅ CARETAKER CAN VIEW STATS
async function getExpenseStats(req, res) {
  try {
    const filters = listExpensesQuerySchema.parse(req.query);
    const stats = await expenseService.getExpenseStats(req.user, filters);

    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

// ❌ CARETAKER CANNOT VIEW PROFIT (Financial sensitive)
async function calculateProfit(req, res) {
  try {
    const filters = profitSummarySchema.parse(req.query);
    const profit = await expenseService.calculateProfit(req.user, filters);

    res.json({
      success: true,
      profit,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

module.exports = {
  listExpenses,
  createExpense,
  getExpense,
  updateExpense,
  deleteExpense,
  getCategoryStats,
  getExpenseCategories,
  getExpenseStats,
  calculateProfit,
};