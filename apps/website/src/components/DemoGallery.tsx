export type Demo = { src: string; title: string; caption: string };

/**
 * A horizontally scrolling strip of demo clips below the main video, each
 * autoplaying muted and looped — informative motion (the product itself),
 * not a decorative marquee, since nothing moves until the reader scrolls.
 *
 * The edge fade is the `.scroll-fade-x` CSS-driven mask in `styles.css`:
 * a scroll-timeline animation, no JS, and it only shows on the side that
 * still has content to reveal.
 */
export function DemoGallery({ demos }: Readonly<{ demos: Demo[] }>) {
  return (
    <div className="demo-gallery scroll-fade-x">
      <div className="demo-track">
        <div className="blur-edge blur-edge-left" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        {demos.map(({ src, title, caption }) => (
          <div key={src} className="demo-card">
            <div className="demo-thumb">
              <video
                src={src}
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                aria-label={title}
              />
            </div>
            <div className="demo-caption">
              <span className="demo-title">{title}</span>
              <span className="demo-desc">{caption}</span>
            </div>
          </div>
        ))}
        <div className="blur-edge blur-edge-right" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}
