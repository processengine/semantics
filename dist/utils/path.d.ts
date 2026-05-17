export type PathSegment = string | number;
export declare function parsePath(path: string): PathSegment[] | null;
export declare function isValidPath(path: unknown): path is string;
export declare function isWritablePath(path: string): boolean;
export declare function normalizePath(path: string): PathSegment[];
export declare function getPath(target: unknown, path: string): {
    found: boolean;
    value: unknown;
};
export declare function setPath<T extends Record<string, unknown>>(target: T, path: string, value: unknown): T;
export declare function resolveInput(target: unknown, inputRef: string): unknown;
export declare function isPathObject(value: unknown): boolean;
export declare function isIdentifierSegment(segment: string): boolean;
