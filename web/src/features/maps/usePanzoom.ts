import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";
import Panzoom from "@panzoom/panzoom";
import { setBoundedImageTransform } from "./map-pan-bounds.js";
import { handleMapKeydown } from "./map-keyboard.js";

interface UsePanzoomOptions {
  active: boolean;
  fit?: boolean;
  focus?: { x: number; y: number; scale?: number };
  animateFocus?: boolean;
  sourceKey?: string;
}

export function usePanzoom(
  stage: RefObject<HTMLElement | null>,
  art: RefObject<HTMLElement | null>,
  image: RefObject<HTMLImageElement | null>,
  { active, fit = false, focus, animateFocus = false, sourceKey }: UsePanzoomOptions,
) {
  const instanceRef = useRef<ReturnType<typeof Panzoom> | null>(null);
  const zoomIn = useCallback(() => { instanceRef.current?.zoomIn({ animate: false }); }, []);
  const zoomOut = useCallback(() => { instanceRef.current?.zoomOut({ animate: false }); }, []);
  const reset = useCallback(() => { instanceRef.current?.reset({ animate: false }); }, []);

  useEffect(() => {
    const viewport = stage.current;
    const artwork = art.current;
    const mapImage = image.current;
    if (!active || !viewport || !artwork || !mapImage) return;
    let instance: ReturnType<typeof Panzoom> | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let wheelListener: ((event: WheelEvent) => void) | null = null;
    let focusFrame: number | null = null;

    const cancelFocus = () => {
      if (focusFrame !== null) cancelAnimationFrame(focusFrame);
      focusFrame = null;
    };

    const destroyPanzoom = () => {
      cancelFocus();
      if (wheelListener) viewport.removeEventListener("wheel", wheelListener);
      wheelListener = null;
      if (instanceRef.current === instance) instanceRef.current = null;
      instance?.destroy();
      instance = null;
    };

    const initialize = () => {
      if (!mapImage.naturalWidth || !mapImage.naturalHeight || !viewport.clientWidth || !viewport.clientHeight) return;
      destroyPanzoom();
      if (fit) {
        const style = window.getComputedStyle(viewport);
        const width = viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const height = viewport.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
        const scale = Math.min(width / mapImage.naturalWidth, height / mapImage.naturalHeight);
        artwork.style.width = `${Math.round(mapImage.naturalWidth * scale)}px`;
        artwork.style.height = `${Math.round(mapImage.naturalHeight * scale)}px`;
      }
      instance = Panzoom(artwork, {
        canvas: true,
        minScale: 1,
        maxScale: 7,
        startScale: 1,
        panOnlyWhenZoomed: true,
        pinchAndPan: true,
        setTransform: (element, values) => {
          const bounded = setBoundedImageTransform(element as HTMLElement, viewport, values);
          if (bounded.x !== values.x || bounded.y !== values.y) {
            const current = instance;
            requestAnimationFrame(() => {
              if (instance === current) current?.pan(bounded.x, bounded.y, { animate: false, relative: false });
            });
          }
        },
        touchAction: "none",
        cursor: "grab",
      });
      instanceRef.current = instance;
      wheelListener = instance.zoomWithWheel;
      viewport.addEventListener("wheel", wheelListener, { passive: false });
      if (focus && !fit) {
        const active = instance;
        const moveToFocus = () => {
          if (instance !== active) return;
          const animate = animateFocus && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          const motion = { animate, duration: 900, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };
          active.zoom(focus.scale ?? 2, motion);
          const targetX = focus.x * artwork.clientWidth;
          const targetY = focus.y * artwork.clientHeight;
          active.pan(
            artwork.clientWidth / 2 - targetX,
            artwork.clientHeight / 2 - targetY,
            { ...motion, relative: false },
          );
        };
        // Let the complete map paint before starting the camera transition.
        focusFrame = requestAnimationFrame(() => {
          focusFrame = requestAnimationFrame(moveToFocus);
        });
      }
    };

    const onKeydown = (event: KeyboardEvent) => {
      handleMapKeydown(event, viewport, instance);
    };
    viewport.addEventListener("keydown", onKeydown);
    if (mapImage.complete && mapImage.naturalWidth) initialize();
    else mapImage.addEventListener("load", initialize, { once: true });
    resizeObserver = new ResizeObserver(() => {
      if (!mapImage.naturalWidth) return;
      initialize();
    });
    resizeObserver.observe(viewport);

    return () => {
      viewport.removeEventListener("keydown", onKeydown);
      mapImage.removeEventListener("load", initialize);
      resizeObserver?.disconnect();
      destroyPanzoom();
    };
  }, [active, animateFocus, art, fit, focus?.x, focus?.y, focus?.scale, image, sourceKey, stage]);

  return { zoomIn, zoomOut, reset };
}
