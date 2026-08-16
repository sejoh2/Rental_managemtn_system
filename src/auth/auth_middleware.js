const token_service = require("../security/token_service");
const auth_service = require("./auth_service");

async function authenticate(req, res, next) {
    try {
        const authorization = req.headers.authorization;

        if (!authorization || !authorization.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                error: "Authorization token is required",
            });
        }

        const access_token = authorization.split(" ")[1];

        const decoded = token_service.verify_access_token(access_token);

        if (decoded.type !== "access") {
            return res.status(401).json({
                success: false,
                error: "Invalid access token",
            });
        }

        const user = await auth_service.get_user_by_id(
            decoded.user_id
        );

        if (!user || user.status !== "active") {
            return res.status(401).json({
                success: false,
                error: "User not found or inactive",
            });
        }

        req.user = user;

        return next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            error: "Invalid or expired token",
        });
    }
}

module.exports = {
    authenticate,
};