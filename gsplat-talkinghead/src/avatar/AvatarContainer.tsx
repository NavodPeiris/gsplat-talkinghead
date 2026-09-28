import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { LazyAvatarController } from './LazyAvatarController';
import type { IAvatarController } from './GaussianAvatarController';

export interface UseAvatarControllerResult {
  containerRef: RefObject<HTMLDivElement | null>;
  controllerRef: RefObject<IAvatarController | null>;
  error: Error | null;
  /** True once the avatar bundle has loaded and the renderer is running. */
  ready: boolean;
}

/**
 * Mounts a `LazyAvatarController` (Gaussian-splat renderer, dynamically
 * imported) into `containerRef.current` and keeps it alive for the
 * lifetime of `assetsPath`. Recreates the avatar whenever `assetsPath`
 * changes; disposes on unmount.
 */
export function useAvatarController(assetsPath: string, backgroundColor?: string): UseAvatarControllerResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<IAvatarController | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || !assetsPath) return;
    setError(null);
    setReady(false);

    const controller = new LazyAvatarController(containerRef.current, assetsPath, {
      backgroundColor,
      onReady: () => setReady(true),
      onError: (err) => setError(err),
    });
    controllerRef.current = controller;

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
    // Reactive dependency is only assetsPath — backgroundColor changes don't
    // warrant a full avatar reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetsPath]);

  return { containerRef, controllerRef, error, ready };
}

export interface AvatarContainerProps {
  /** Ref from `useAvatarController` — the div the renderer mounts into. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Array of background image URLs. One is chosen at random each mount. */
  backgroundImages?: string[];
  className?: string;
}

/**
 * Sizes and layers the avatar's mount point over an optional random
 * background image. Replaces the old R3F `<Canvas>` + `AvatarScene`.
 */
export function AvatarContainer({ containerRef, backgroundImages = [], className }: AvatarContainerProps) {
  const backgroundUrl = useMemo(
    () => (backgroundImages.length > 0 ? backgroundImages[Math.floor(Math.random() * backgroundImages.length)] : null),
    // Stable per mount — intentionally not reactive to `backgroundImages` identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div className={className} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {backgroundUrl && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `url(${backgroundUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      )}
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
    </div>
  );
}
