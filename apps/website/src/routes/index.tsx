import { Link, createFileRoute } from "@tanstack/react-router";

import { useAnalytics } from "../analytics";
import { DemoGallery, type Demo } from "../components/DemoGallery";
import { AppleGlyph, InkraMark } from "../components/Mark";

const FEATURES = [
  { label: "Private", description: "all your documents live in your computer" },
  { label: "Blazing fast", description: "cold starts takes a fraction of a second" },
  { label: "Extended markdown", description: "mermaid charts, tables and HTML" },
  { label: "Multiwindow", description: "snappy switch between multiple workspaces" },
  { label: "Frontmatter", description: "YAML metadata support built-in" },
];

const HERO_VIDEO = "/demo-videos/04.mp4";

// The nine source clips repeat several scenes verbatim (00 = 08, 02 = 06);
// this is the deduplicated set, one entry per distinct feature actually shown.
const DEMOS: Demo[] = [
  {
    src: "/demo-videos/00.mp4",
    title: "Frontmatter",
    caption: "YAML metadata as structured properties",
  },
  {
    src: "/demo-videos/01.mp4",
    title: "Command palette",
    caption: "Every action, one keystroke away",
  },
  {
    src: "/demo-videos/02.mp4",
    title: "Theme customization",
    caption: "Colors, fonts, and contrast — yours to tune",
  },
  {
    src: "/demo-videos/03.mp4",
    title: "Mermaid diagrams",
    caption: "Charts rendered straight from code fences",
  },
  {
    src: "/demo-videos/07.mp4",
    title: "Syntax highlighting",
    caption: "Code blocks that read like code",
  },
];

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const capture = useAnalytics();

  return (
    <div className="site">
      <header className="site-header">
        <Link className="brand" to="/" aria-label="Inkra">
          <InkraMark size={16} />
        </Link>
        <nav className="site-nav">
          <a
            className="nav-link"
            href={__INKRA_RELEASES_URL__}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => capture("updates_opened")}
          >
            Updates
          </a>
          <a
            className="nav-link"
            href={__INKRA_REPO_URL__}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => capture("github_opened")}
          >
            GitHub
          </a>
        </nav>
      </header>

      <section className="hero-section">
        <h1 className="headline">Fast and lightweight app for your workspace's markdown files</h1>

        <div className="cta">
          <a
            className="download"
            href={__INKRA_DMG_URL__}
            onClick={() => capture("download_started", { app_version: __INKRA_VERSION__ })}
          >
            <AppleGlyph size={20} />
            <span>Download for macOS</span>
          </a>
          <span className="alpha-pill">Alpha</span>
          <span className="version">v{__INKRA_VERSION__}</span>
        </div>

        <p className="caption">Free and open source. Forever.</p>
      </section>

      <section className="demo-section">
        <div className="hero-video">
          <video
            src={HERO_VIDEO}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-label="Inkra app demo"
          />
        </div>
        <DemoGallery demos={DEMOS} />
      </section>

      <section className="features">
        {FEATURES.map(({ label, description }) => (
          <div className="feature" key={label}>
            <span className="feature-label">{label}</span>
            <span className="feature-desc">{description}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
