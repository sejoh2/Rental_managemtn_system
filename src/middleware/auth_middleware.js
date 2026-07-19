const tokenService = require('../services/token_service');
const authService = require('../services/auth_service');

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Authorization token is required',
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = tokenService.verifyAccessToken(token);

    if (decoded.type !== 'access') {
      return res.status(401).json({
        success: false,
        error: 'Invalid access token',
      });
    }

    const user = await authService.getUserById(decoded.id);

    if (!user || user.status !== 'active') {
      return res.status(401).json({
        success: false,
        error: 'User not found or inactive',
      });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      error: 'Invalid or expired token',
    });
  }
}

module.exports = {
  authenticate,
};