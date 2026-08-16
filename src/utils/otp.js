function generate_otp(length = 6) {
    if (!Number.isInteger(length) || length < 4) {
        throw new Error("OTP length must be at least 4 digits");
    }

    const min = 10 ** (length - 1);
    const max = 10 ** length - 1;

    return String(
        Math.floor(Math.random() * (max - min + 1)) + min
    );
}

module.exports = {
    generate_otp,
};