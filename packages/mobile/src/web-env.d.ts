// packages/web/src/lib modules are imported for their types and pure helpers.
// They read Vite's import.meta.env, which this declaration satisfies for tsc.
interface ImportMeta {
  readonly env: Record<string, string | undefined>;
}
