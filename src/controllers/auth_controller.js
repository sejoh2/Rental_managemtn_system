const authService = require('../services/auth_service');
const tokenService = require('../services/token_service');

async function requestOtp(req, res) {
  try {
    const { phone } = req.body;
    const result = await authService.requestOtp(phone, req.ip);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

async function verifyOtp(req, res) {
  try {
    const { phone, code } = req.body;
    const result = await authService.verifyOtp(phone, code, req.ip);

    res.json({
      success: true,
      message: 'Logged in successfully',
      ...result,
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      error: error.message,
    });
  }
}

async function refreshToken(req, res) {
  try {
    const { refreshToken } = req.body;
    const result = await authService.refresh(refreshToken);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      error: error.message,
    });
  }
}

async function logout(req, res) {
  try {
    const { refreshToken } = req.body;
    await authService.logout(refreshToken);

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  }
}

async function me(req, res) {
  res.json({
    success: true,
    user: tokenService.publicUser(req.user),
  });
}

module.exports = {
  requestOtp,
  verifyOtp,
  refreshToken,
  logout,
  me,
};