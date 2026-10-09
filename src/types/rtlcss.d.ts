declare module 'rtlcss' {
  const rtlcss: { process(css: string, options?: Record<string, unknown>): string };
  export default rtlcss;
}
