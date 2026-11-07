// Provider seam: swap this binding (or add env-based selection) when a
// second provider lands. Cloudflare is the first implementation.
export { cloudflareStaticSite as deployStaticSite } from "./cloudflare.ts";
