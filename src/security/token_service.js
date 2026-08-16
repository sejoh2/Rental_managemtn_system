const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const db = require("../config/db");

function public_user(user) {
    return {
        user_id: user.user_id,
        first_name: user.first_name,
        last_name: user.last_name,
        phone: user.phone,
        role: user.role,
        status: user.status,
        owner_id: user.owner_id || null,
        created_at: user.created_at,
    };
}

function create_access_token(user) {
    return jwt.sign(
        {
            user_id: user.user_id,
            phone: user.phone,
            role: user.role,
            owner_id: user.owner_id || null,
            type: "access",
        },
        process.env.JWT_ACCESS_SECRET,
        {
            expiresIn:
                process.env.ACCESS_TOKEN_EXPIRES_IN || "15m",
        }
    );
}

function create_refresh_token(user) {
    return jwt.sign(
        {
            user_id: user.user_id,
            phone: user.phone,
            role: user.role,
            owner_id: user.owner_id || null,
            type: "refresh",
        },
        process.env.JWT_REFRESH_SECRET,
        {
            expiresIn:
                process.env.REFRESH_TOKEN_EXPIRES_IN || "30d",
        }
    );
}

async function issue_tokens(user) {
    const access_token = create_access_token(user);

    const refresh_token = create_refresh_token(user);

    const refresh_token_hash = await bcrypt.hash(
        refresh_token,
        12
    );

    const decoded = jwt.decode(refresh_token);

    const expires_at = new Date(decoded.exp * 1000);

    await db.query(
        `
        INSERT INTO refresh_tokens (
            user_id,
            token_hash,
            expires_at
        )
        VALUES ($1, $2, $3)
        `,
        [
            user.user_id,
            refresh_token_hash,
            expires_at,
        ]
    );

    return {
        access_token,
        refresh_token,
    };
}

function verify_access_token(token) {
    return jwt.verify(
        token,
        process.env.JWT_ACCESS_SECRET
    );
}

function verify_refresh_token(token) {
    return jwt.verify(
        token,
        process.env.JWT_REFRESH_SECRET
    );
}

module.exports = {
    public_user,
    issue_tokens,
    verify_access_token,
    verify_refresh_token,
};