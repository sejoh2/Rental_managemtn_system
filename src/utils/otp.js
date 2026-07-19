function generateOtp(length = 6) {
  const min = 10 ** (length - 1);
  const max = 10 ** length - 1;

  return String(Math.floor(Math.random() * (max - min + 1)) + min);
}

module.exports = {
  generateOtp,
};