// `@myned-ai/gsplat-flame-avatar-renderer` creates its own canvas and
// WebGLRenderer internally, with no option for transparency: the context is
// opaque (`alpha: false`) and cleared with a solid color (white by default).
// That hides anything layered behind the canvas, e.g. `backgroundImages`.
//
// Browsers hand back the *existing* context when `getContext` is called on a
// canvas a second time, so if we create the context first — with alpha — the
// renderer ends up using ours. We do that by intercepting `getContext` for
// canvases inside the given container while the renderer is being set up,
// and pinning the clear color to fully transparent.

const containers = new Set<HTMLElement>();
let originalGetContext: typeof HTMLCanvasElement.prototype.getContext | null = null;

function isInsideTrackedContainer(canvas: HTMLCanvasElement): boolean {
  for (const container of containers) {
    if (container.contains(canvas)) return true;
  }
  return false;
}

function install(): void {
  if (originalGetContext) return;
  const original = HTMLCanvasElement.prototype.getContext;
  originalGetContext = original;

  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    contextId: string,
    attributes?: Record<string, unknown>,
  ) {
    if (!contextId.startsWith('webgl') || !isInsideTrackedContainer(this)) {
      return original.call(this, contextId, attributes);
    }
    const gl = original.call(this, contextId, {
      ...attributes,
      alpha: true,
      premultipliedAlpha: true,
    }) as WebGLRenderingContext | WebGL2RenderingContext | null;
    if (gl) {
      // The renderer calls setClearColor(color, 1.0) (opaque). Premultiplied
      // alpha needs rgb <= alpha, so clear to all zeros.
      const clearColor = gl.clearColor.bind(gl);
      gl.clearColor = () => clearColor(0, 0, 0, 0);
    }
    return gl;
  } as typeof HTMLCanvasElement.prototype.getContext;
}

function uninstall(): void {
  if (!originalGetContext || containers.size > 0) return;
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  originalGetContext = null;
}

/**
 * Runs `setup` with any WebGL context created inside `container` forced to
 * be transparent. Safe with concurrent calls for different containers.
 */
export async function withTransparentCanvas<T>(container: HTMLElement, setup: () => Promise<T>): Promise<T> {
  containers.add(container);
  install();
  try {
    return await setup();
  } finally {
    containers.delete(container);
    uninstall();
  }
}
