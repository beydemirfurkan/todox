"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/icons";

interface MemoryStep {
  command: string;
  label: string;
  text: string;
}

export function MemoryDemo({ title, replayLabel, steps }: {
  title: string;
  replayLabel: string;
  steps: [MemoryStep, MemoryStep];
}): React.JSX.Element {
  const preview = useRef<HTMLElement>(null);
  const [playback, setPlayback] = useState(0);

  useEffect(() => {
    if (!preview.current || !window.IntersectionObserver) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setPlayback((previous) => previous || 1);
      observer.disconnect();
    }, { threshold: 0.25 });
    observer.observe(preview.current);
    return () => observer.disconnect();
  }, []);

  return (
    <figure ref={preview} className="memory-demo">
      <figcaption className="flex items-center justify-between gap-2 text-small font-medium text-ink">
        <span className="flex items-center gap-2.5">
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-accent" />
          {title}
        </span>
        <button
          type="button"
          className="memory-demo-replay icon-button !size-11 shrink-0"
          aria-label={replayLabel}
          title={replayLabel}
          onClick={() => setPlayback((previous) => previous + 1)}
        >
          <Icon name="replay" size={18} />
        </button>
      </figcaption>
      <ol key={playback} className="memory-flow" data-playing={playback > 0 || undefined}>
        {steps.map(({ command, label, text }, index) => (
          <li key={command} className="memory-step">
            <div className="mono flex flex-wrap items-center justify-between gap-x-3 text-meta text-muted">
              <span>{label}</span>
              <code className="text-accentInk">{command}</code>
            </div>
            <p className="mt-2 text-body leading-snug text-ink">{text}</p>
            {index === 0 && <span aria-hidden="true" className="memory-transfer" />}
          </li>
        ))}
      </ol>
    </figure>
  );
}
