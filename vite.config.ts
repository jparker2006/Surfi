import { defineConfig } from 'vite'
import { execSync } from 'node:child_process'

// Build stamp. Bake the short git hash (plus a -dirty marker for an uncommitted
// working tree) and the build time into the bundle, so the running build can be
// identified at a glance in the debug HUD and the console on load. This is how
// we confirm a deploy actually contains a given fix rather than a stale build.
function buildHash(): string {
  try {
    return execSync('git describe --always --dirty --abbrev=7').toString().trim()
  } catch {
    return 'nogit'
  }
}

export default defineConfig({
  define: {
    __BUILD_HASH__: JSON.stringify(buildHash()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
})
