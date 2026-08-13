// Vitest stub for the `server-only` guard. The real package throws when a
// module is pulled into a client bundle; under test every module is server
// code, so importing it must be a no-op rather than a failure.
export {};
