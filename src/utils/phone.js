function normalize_phone(phone) {
    const raw = String(phone || "")
        .trim()
        .replace(/\s+/g, "");

    if (!raw) {
        return "";
    }

    if (raw.startsWith("+")) {
        return raw;
    }

    if (raw.startsWith("254")) {
        return `+${raw}`;
    }

    if (raw.startsWith("0") && raw.length === 10) {
        return `+254${raw.slice(1)}`;
    }

    return raw;
}

function mask_phone(phone) {
    const normalized_phone = normalize_phone(phone);

    if (normalized_phone.length < 7) {
        return normalized_phone;
    }

    return `${normalized_phone.slice(0, 4)}****${normalized_phone.slice(-3)}`;
}

module.exports = {
    normalize_phone,
    mask_phone,
};