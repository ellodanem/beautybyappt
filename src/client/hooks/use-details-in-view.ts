import { useEffect, useState } from "preact/hooks";
import type { RefObject } from "preact";

export function useDetailsInView(
  ref: RefObject<HTMLElement | null>,
  enabled = true,
) {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setInView(false);
      return;
    }

    const element = ref.current;
    if (!element) {
      setInView(false);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.25 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, ref]);

  return inView;
}
