/// <reference types="@vgpu/wgsl/wgsl-types" />
/// <reference types="@webgpu/types" />

/*
 * `import notesShader from "./notes.wgsl"` resolves to a prepared `ShaderSource`
 * built by the `wgslVitePlugin()` in vite.config.ts — not a string. The ambient
 * declaration above lives in the `@vgpu/wgsl` package so it stays correct if the
 * emitted shape ever changes.
 */
