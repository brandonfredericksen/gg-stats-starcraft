/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

// Values the client builds inject into `import.meta.env`, on top of Vite's own (MODE, DEV, PROD,
// ...). Declaring the interface here merges with the one `vite/client` provides.
interface ImportMetaEnv {
  /** Client version, used to cache-bust things that aren't content-hashed. */
  readonly GGSTATS_VERSION: string
}
