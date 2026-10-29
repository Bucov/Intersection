/** True when the browser can create a WebGL context (WebGL 2 preferred). */
export function detectWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const context = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!context) return false;
    // Release the probe context immediately; browsers cap live contexts.
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
