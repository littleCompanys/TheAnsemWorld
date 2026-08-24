import { useEffect, useState } from "react";

/**
 * Sample pieces shown on Home's hero and Mint's preview. Index 0 is
 * deliberately The Black Bull - the piece people recognize as "the"
 * Ansem World art - followed by every preview image that ships in
 * /public/collection-preview, so the hero cycles the whole sample set.
 */
export const CAROUSEL_IMAGES = [
  "/carousel/1.png", // The Black Bull
  ...Array.from({ length: 12 }, (_, i) => `/collection-preview/${i + 1}.png`),
];

/**
 * Infinite-loop image carousel: prev/next always wrap, so there is no
 * dead end at either side. Auto-advances every 2.5s; the prev/next
 * buttons and dots still work for manually jumping ahead.
 */
export function Carousel({
  images = CAROUSEL_IMAGES,
  className = "",
  imgClassName = "",
  alt = "The Ansem World piece",
  index: controlledIndex,
  onIndexChange,
}: {
  images?: string[];
  className?: string;
  imgClassName?: string;
  alt?: string;
  /** Pass both to drive the slide from outside (e.g. advance it after a
   * successful mint); omit both to let the carousel manage itself. */
  index?: number;
  onIndexChange?: (index: number) => void;
}) {
  const [localIndex, setLocalIndex] = useState(0);
  const len = images.length;
  const index =
    controlledIndex !== undefined ? ((controlledIndex % len) + len) % len : localIndex;
  const setIndex = onIndexChange ?? setLocalIndex;

  const prev = () => setIndex((index - 1 + len) % len);
  const next = () => setIndex((index + 1) % len);

  useEffect(() => {
    if (len <= 1) return;
    // Re-armed every time the slide changes (including manual nav), so
    // the interval always advances from the piece actually on screen.
    const id = setTimeout(next, 2500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, len]);

  if (len === 0) return null;

  return (
    <div className={`carousel ${className}`}>
      <div
        className="carousel-track"
        style={{
          width: `${len * 100}%`,
          transform: `translateX(-${(index * 100) / len}%)`,
        }}
      >
        {images.map((src, i) => (
          <img
            key={src}
            className={`carousel-img ${imgClassName}`}
            style={{ width: `${100 / len}%` }}
            src={src}
            alt={`${alt} (${i + 1}/${len})`}
          />
        ))}
      </div>
      {len > 1 && (
        <>
          <button
            type="button"
            className="carousel-nav carousel-prev"
            onClick={prev}
            aria-label="Previous piece"
          >
            ‹
          </button>
          <button
            type="button"
            className="carousel-nav carousel-next"
            onClick={next}
            aria-label="Next piece"
          >
            ›
          </button>
          <div className="carousel-dots">
            {images.map((_, i) => (
              <button
                key={i}
                type="button"
                className={`carousel-dot${i === index ? " active" : ""}`}
                onClick={() => setIndex(i)}
                aria-label={`Go to piece ${i + 1}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
