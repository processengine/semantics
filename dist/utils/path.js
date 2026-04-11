import { XRuntimeError } from '../errors/index.js';
import { isNonEmptyString, isRecord } from './guards.js';
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const WRITABLE_ZONE_NAMES = new Set(['checks', 'facts', 'decisions']);
function readQuotedSegment(path, index) {
    const quote = path[index];
    if (quote !== '"' && quote !== "'")
        return null;
    let value = '';
    let cursor = index + 1;
    while (cursor < path.length) {
        const char = path[cursor];
        if (char === '\\') {
            const escaped = path[cursor + 1];
            if (escaped === undefined)
                return null;
            value += escaped;
            cursor += 2;
            continue;
        }
        if (char === quote)
            return { value, nextIndex: cursor + 1 };
        value += char;
        cursor += 1;
    }
    return null;
}
export function parsePath(path) {
    if (!isNonEmptyString(path) || !path.startsWith('$.'))
        return null;
    const segments = [];
    let cursor = 2;
    if (cursor >= path.length)
        return null;
    while (cursor < path.length) {
        const char = path[cursor];
        if (char === '.') {
            cursor += 1;
            if (cursor >= path.length)
                return null;
            continue;
        }
        if (char === '[') {
            const next = path[cursor + 1];
            if (next === undefined)
                return null;
            if (next === '"' || next === "'") {
                const quoted = readQuotedSegment(path, cursor + 1);
                if (!quoted || path[quoted.nextIndex] !== ']')
                    return null;
                if (quoted.value.length === 0)
                    return null;
                segments.push(quoted.value);
                cursor = quoted.nextIndex + 1;
                continue;
            }
            const remaining = path.slice(cursor + 1);
            const match = remaining.match(/^(\d+)\]/u);
            if (!match)
                return null;
            segments.push(Number(match[1]));
            cursor += match[0].length + 1;
            continue;
        }
        const identifierMatch = path.slice(cursor).match(/^[A-Za-z_][A-Za-z0-9_]*/u);
        if (!identifierMatch)
            return null;
        segments.push(identifierMatch[0]);
        cursor += identifierMatch[0].length;
    }
    return segments.length >= 1 ? segments : null;
}
export function isValidPath(path) {
    return typeof path === 'string' && parsePath(path) !== null;
}
export function isWritablePath(path) {
    const segments = parsePath(path);
    if (!segments || segments.length < 2)
        return false;
    return segments[0] === 'context' && typeof segments[1] === 'string' && WRITABLE_ZONE_NAMES.has(segments[1]);
}
export function normalizePath(path) {
    const segments = parsePath(path);
    if (!segments) {
        throw new XRuntimeError('FLOW_PATH_NOT_RESOLVED', `Path is invalid: ${path}`, { path });
    }
    return segments;
}
export function getPath(target, path) {
    const segments = normalizePath(path);
    let current = target;
    for (const segment of segments) {
        if (typeof segment === 'number') {
            if (!Array.isArray(current) || segment >= current.length)
                return { found: false, value: undefined };
            current = current[segment];
            continue;
        }
        if (!isRecord(current) || !(segment in current))
            return { found: false, value: undefined };
        current = current[segment];
    }
    if (current === undefined)
        return { found: false, value: undefined };
    return { found: true, value: current };
}
function createContainer(nextSegment) {
    return typeof nextSegment === 'number' ? [] : {};
}
export function setPath(target, path, value) {
    if (!isWritablePath(path)) {
        throw new XRuntimeError('FLOW_STATE_INVALID', `Path is not writable: ${path}`, { path });
    }
    const clone = structuredClone(target);
    const segments = normalizePath(path);
    let current = clone;
    for (let index = 0; index < segments.length - 1; index += 1) {
        const segment = segments[index];
        const nextSegment = segments[index + 1];
        if (typeof segment === 'number') {
            if (!Array.isArray(current)) {
                throw new XRuntimeError('FLOW_STATE_INVALID', 'Path expects array container', { path, segment });
            }
            const existing = current[segment];
            if (existing === undefined || existing === null || typeof existing !== 'object') {
                current[segment] = createContainer(nextSegment);
            }
            current = current[segment];
            continue;
        }
        if (!isRecord(current)) {
            throw new XRuntimeError('FLOW_STATE_INVALID', 'Path expects object container', { path, segment });
        }
        const existing = current[segment];
        if (existing === undefined || existing === null || typeof existing !== 'object') {
            current[segment] = createContainer(nextSegment);
        }
        current = current[segment];
    }
    const lastSegment = segments[segments.length - 1];
    if (typeof lastSegment === 'number') {
        if (!Array.isArray(current)) {
            throw new XRuntimeError('FLOW_STATE_INVALID', 'Path expects array container', { path, segment: lastSegment });
        }
        current[lastSegment] = value;
    }
    else {
        if (!isRecord(current)) {
            throw new XRuntimeError('FLOW_STATE_INVALID', 'Path expects object container', { path, segment: lastSegment });
        }
        current[lastSegment] = value;
    }
    return clone;
}
function resolveInputObject(target, inputRef) {
    const resolved = {};
    for (const [key, nested] of Object.entries(inputRef)) {
        if (typeof nested === 'string') {
            const pathResult = getPath(target, nested);
            if (!pathResult.found) {
                throw new XRuntimeError('FLOW_PATH_NOT_RESOLVED', `Path is not resolved: ${nested}`, { path: nested });
            }
            resolved[key] = pathResult.value;
            continue;
        }
        resolved[key] = resolveInputObject(target, nested);
    }
    return resolved;
}
export function resolveInput(target, inputRef) {
    if (typeof inputRef === 'string') {
        const pathResult = getPath(target, inputRef);
        if (!pathResult.found) {
            throw new XRuntimeError('FLOW_PATH_NOT_RESOLVED', `Path is not resolved: ${inputRef}`, { path: inputRef });
        }
        return pathResult.value;
    }
    return resolveInputObject(target, inputRef);
}
export function isPathObject(value) {
    return isRecord(value);
}
export function isIdentifierSegment(segment) {
    return IDENTIFIER_RE.test(segment);
}
