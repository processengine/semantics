import { isRecord } from './guards.js';
export function isJsonSafe(value) {
    if (value === null)
        return true;
    if (typeof value === 'string' || typeof value === 'boolean')
        return true;
    if (typeof value === 'number')
        return Number.isFinite(value);
    if (Array.isArray(value))
        return value.every((item) => isJsonSafe(item));
    if (!isRecord(value))
        return false;
    return Object.values(value).every((item) => isJsonSafe(item));
}
