function normalizePhone(phone) {
  const raw = String(phone || '').trim().replace(/\s+/g, '');

  if (!raw) {
    return '';
  }

  if (raw.startsWith('+')) {
    return raw;
  }

  if (raw.startsWith('254')) {
    return `+${raw}`;
  }

  if (raw.startsWith('0') && raw.length === 10) {
    return `+254${raw.slice(1)}`;
  }

  return raw;
}

function maskPhone(phone) {
  const normalized = normalizePhone(phone);

  if (normalized.length < 7) {
    return normalized;
  }

  return `${normalized.slice(0, 4)}****${normalized.slice(-3)}`;
}

module.exports = {
  normalizePhone,
  maskPhone,
};