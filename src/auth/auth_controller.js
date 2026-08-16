const auth_service = require("./auth_service");
const token_service = require("../security/token_service");

async function request_otp(req, res) {
    try {
        const { phone } = req.body;

        const result = await auth_service.request_otp(
            phone,
            req.ip
        );

        return res.json({
            success: true,
            ...result,
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            error: error.message,
        });
    }
}

async function verify_otp(req, res) {
    try {
        const { phone, code } = req.body;

        const result = await auth_service.verify_otp(
            phone,
            code,
            req.ip
        );

        return res.json({
            success: true,
            message: "Logged in successfully",
            ...result,
        });
    } catch (error) {
        return res.status(401).json({
            success: false,
            error: error.message,
        });
    }
}

async function refresh_token(req, res) {
    try {
        const { refresh_token } = req.body;

        const result = await auth_service.refresh(
            refresh_token
        );

        return res.json({
            success: true,
            ...result,
        });
    } catch (error) {
        return res.status(401).json({
            success: false,
            error: error.message,
        });
    }
}

async function logout(req, res) {
    try {
        const { refresh_token } = req.body;

        await auth_service.logout(refresh_token);

        return res.json({
            success: true,
            message: "Logged out successfully",
        });
    } catch (error) {
        return res.json({
            success: true,
            message: "Logged out successfully",
        });
    }
}

async function me(req, res) {
    return res.json({
        success: true,
        user: token_service.public_user(req.user),
    });
}

module.exports = {
    request_otp,
    verify_otp,
    refresh_token,
    logout,
    me,
};