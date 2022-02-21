import { attach, createEffect, createStore, guard, Store } from "effector";
import throttle from "lodash.throttle";
import * as THREE from "three";
import { Vector2 } from "three";
import { IntersectionsManager } from "./createIntersectionManager";

export type DragHandlers = {
  onStart(data: {
    event: MouseEvent;
    activeElement: THREE.Intersection<THREE.Object3D<THREE.Event>>;
  }): void;
  onDrag(distance: number): void;
  onEnd(): void;
};

export const createDragManager = ({
  intersectionsManager,
}: {
  intersectionsManager: IntersectionsManager;
}) => {
  let activeElementCache = null;
  let mousePositionCache = new Vector2(0, 0);
  let currentDragHandlerCache: ((distance: number) => void) | null = null;

  const onDragEnd = createEffect((_: any) => null);
  const onDrag = createEffect((event: MouseEvent) => {
    const distance = event.x - mousePositionCache.x;
    currentDragHandlerCache!(distance);
  });

  const dragHandlersMap = new Map<any, DragHandlers>();

  const $isDragging = createStore(false);
  const onMouseDown = attach({
    source: intersectionsManager.activeElement as Store<
      THREE.Intersection<THREE.Object3D<THREE.Event>>
    >,
    effect: createEffect(
      (params: {
        activeElement: THREE.Intersection<THREE.Object3D<THREE.Event>>;
        event: MouseEvent;
      }) => {
        const handlers = dragHandlersMap.get(params.activeElement.object);        
        return handlers ? { ...handlers, event: params.event } : null;
      }
    ),
    mapParams: (event: MouseEvent, activeElement) => ({ event, activeElement }),
  });

  const onDragStart = attach({
    source: intersectionsManager.activeElement as Store<
      THREE.Intersection<THREE.Object3D<THREE.Event>>
    >,
    effect: createEffect(
      (params: {
        activeElement: THREE.Intersection<THREE.Object3D<THREE.Event>>;
        event: MouseEvent;
        handler: DragHandlers;
      }) => {
        params.event.preventDefault();
        params.event.stopImmediatePropagation();

        const handlers = dragHandlersMap.get(params.activeElement.object)!;
        handlers.onStart({
          activeElement: params.activeElement,
          event: params.event,
        });

        mousePositionCache.set(params.event.x, params.event.y);

        activeElementCache = params.activeElement.object;

        currentDragHandlerCache = handlers.onDrag;
      }
    ),
    mapParams: (
      data: { event: MouseEvent; handler: DragHandlers },
      activeElement
    ) => ({
      ...data,
      activeElement,
    }),
  });

  guard(onMouseDown.doneData, {
    filter: Boolean,
    target: onDragStart,
  });

  const onDragDebounced = throttle(onDrag, 100);

  $isDragging.on(onDragStart, () => true).on(onDragEnd, () => false);
  $isDragging.watch((is) => {
    document[is ? "addEventListener" : "removeEventListener"](
      "mousemove",
      onDragDebounced
    );
  });

  const addEventListeners = createEffect(() => {
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mouseup", onDragEnd);
  });

  const removeEventListeners = createEffect(() =>
    document.removeEventListener("mouseup", onDragEnd)
  );

  const register = createEffect(
    (params: {
      object: THREE.Object3D<THREE.Event>;
      handlers: DragHandlers;
    }) => {
      dragHandlersMap.set(params.object, params.handlers);
    }
  );

  const registerSteppedDragControl = <
    C extends number,
    D extends T[] | Readonly<T[]>,
    T
  >(config: {
    resolveCache: () => C;
    dictionary: D;
    handler: (data: T) => any;

    /**
     * The higher, the greater dragging distance is needed in order to change value
     */
    threshold?: number;
    object: THREE.Object3D;
  }) => {
    let cache: C;
    register({
      object: config.object,
      handlers: {
        onStart: () => {
          cache = config.resolveCache();
        },
        onDrag: (distance: number) => {
          const base = config.dictionary.length - 1;
          const threshold = config.threshold || 35;
          const newIdx = Math.round(base - cache - distance / threshold);

          const maxIdx = config.dictionary.length - 1;
          const resultIdx =
            base - (newIdx > maxIdx ? maxIdx : newIdx <= 0 ? 0 : newIdx);

          config.handler(config.dictionary[resultIdx]);
        },
        onEnd: () => {},
      },
    });
  };

  const registerRangeDragControl = <C extends number>(config: {
    resolveCache: () => C;
    range: [number, number];
    handler: (data: C) => any;

    /**
     * The higher, the greater dragging distance is needed in order to change value
     */
    threshold?: number;
    object: THREE.Object3D;
  }) => {
    let cache: C;
    register({
      object: config.object,
      handlers: {
        onStart() {
          cache = config.resolveCache();
        },
        onDrag(distance: number) {
          const base = config.range[1];
          const threshold = config.threshold || 35;
          const newValue = Math.round(base - cache - distance / threshold);

          const maxValue = base;
          const resultValue =
            base -
            (newValue > maxValue
              ? maxValue
              : newValue <= config.range[0]
              ? config.range[0]
              : newValue);

          config.handler(resultValue as C);
        },
        onEnd() {},
      },
    });
  };

  return {
    addEventListeners,
    removeEventListeners,
    register,
    isDragging: $isDragging,
    registerSteppedDragControl,
    registerRangeDragControl,
  };
};

export type DragManager = ReturnType<typeof createDragManager>;

export const disableCameraControlsUponDrag = (config: {
  dragManager: DragManager;
  cameraControls: any;
}) => {
  config.dragManager.isDragging.watch(
    (is) => (config.cameraControls.enabled = !is)
  );
};
