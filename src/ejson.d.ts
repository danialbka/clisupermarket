declare module 'ejson' {
  const EJSON: {
    addType(name: string, fn: (json: unknown) => unknown): void;
    parse(s: string): unknown;
    stringify(v: unknown): string;
  };
  export default EJSON;
}
