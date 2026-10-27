import { registerHooks } from "node:module"

// Resolve the app's aliases and server-only marker in Node's isolated test process.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only")
      return { url: "data:text/javascript,export{}", shortCircuit: true }
    if (specifier.startsWith("@/"))
      return nextResolve(
        new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href,
        context
      )
    return nextResolve(specifier, context)
  },
})
