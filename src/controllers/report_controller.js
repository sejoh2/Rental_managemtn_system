const reportService = require('../services/report_service');
const {
  occupancyReportSchema,
  arrearsReportSchema,
  rentCollectionSchema,
  waterBillingReportSchema,
  tenantStatementSchema,
  exportReportSchema,
  reportHistoryQuerySchema,
} = require('../validators/report_validator');

function getValidationError(error) {
  return error.issues ? error.issues[0].message : error.message;
}

// ============================================================
// OCCUPANCY REPORT
// ============================================================

async function getOccupancyReport(req, res) {
  try {
    const filters = occupancyReportSchema.parse(req.query);
    const report = await reportService.getOccupancyReport(req.user, filters);

    res.json({
      success: true,
      report,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

// ============================================================
// ARREARS REPORT
// ============================================================

async function getArrearsReport(req, res) {
  try {
    const filters = arrearsReportSchema.parse(req.query);
    const report = await reportService.getArrearsReport(req.user, filters);

    res.json({
      success: true,
      report,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

// ============================================================
// RENT COLLECTION REPORT
// ============================================================

async function getRentCollectionReport(req, res) {
  try {
    const filters = rentCollectionSchema.parse(req.query);
    const report = await reportService.getRentCollectionReport(req.user, filters);

    res.json({
      success: true,
      report,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

// ============================================================
// WATER BILLING REPORT
// ============================================================

async function getWaterBillingReport(req, res) {
  try {
    const filters = waterBillingReportSchema.parse(req.query);
    const report = await reportService.getWaterBillingReport(req.user, filters);

    res.json({
      success: true,
      report,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

// ============================================================
// SMS USAGE REPORT
// ============================================================

async function getSmsUsageReport(req, res) {
  try {
    const report = await reportService.getSmsUsageReport(req.user);

    res.json({
      success: true,
      report,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

// ============================================================
// TENANT STATEMENT
// ============================================================

async function getTenantStatement(req, res) {
  try {
    const filters = tenantStatementSchema.parse({ ...req.query, tenant_id: req.params.id });
    const report = await reportService.getTenantStatement(req.user, req.params.id, filters);

    res.json({
      success: true,
      report,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

// ============================================================
// EXPORT REPORT
// ============================================================

async function exportReport(req, res) {
  try {
    const data = exportReportSchema.parse(req.body);
    const result = await reportService.generateExport(req.user, data, req.ip);

    res.status(201).json({
      success: true,
      message: 'Report generated successfully',
      report_id: result.id,
      report_name: result.report_name,
      report_type: result.report_type,
      format: result.format,
      data: result.data,
      expires_at: result.expires_at,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: getValidationError(error),
    });
  }
}

// ============================================================
// REPORT HISTORY
// ============================================================

async function getReportHistory(req, res) {
  try {
    const filters = reportHistoryQuerySchema.parse(req.query);
    const result = await reportService.getReportHistory(req.user, filters);

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

// ============================================================
// DOWNLOAD REPORT
// ============================================================

async function downloadReport(req, res) {
  try {
    // TODO: Implement actual file download
    // For now, just return the report data
    const result = await reportService.getReportHistory(req.user, { limit: 1 });

    if (!result.reports || result.reports.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Report not found',
      });
    }

    res.json({
      success: true,
      message: 'Report download prepared',
      report: result.reports[0],
      download_url: `/api/reports/download/${req.params.id}/file`,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

module.exports = {
  getOccupancyReport,
  getArrearsReport,
  getRentCollectionReport,
  getWaterBillingReport,
  getSmsUsageReport,
  getTenantStatement,
  exportReport,
  getReportHistory,
  downloadReport,
};