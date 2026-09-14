/// <reference types="vite/client" />

import type { ReactNode } from "react";
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";

import { Analytics } from "../analytics";
import styles from "../styles.css?url";

const TITLE = "Inkra — Fast and lightweight markdown editor";
const DESCRIPTION =
  "Fast and lightweight app for your workspace's markdown files. Local-first. macOS.";
const OG_DESCRIPTION = "Fast and lightweight app for your workspace's markdown files.";

// Open Graph needs absolute URLs, and Inkra has no domain registered yet. The
// `.invalid` TLD is reserved by RFC 2606 and can never resolve, so a build that
// ships this placeholder fails loudly in a card validator instead of silently
// pointing somewhere wrong. Replace both uses once the domain exists.
const SITE_ORIGIN = "https://inkra.invalid";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1.0" },
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Inkra" },
      { property: "og:description", content: OG_DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: SITE_ORIGIN },
      { property: "og:image", content: `${SITE_ORIGIN}/og.jpg` },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: `${SITE_ORIGIN}/og.jpg` },
    ],
    links: [
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "stylesheet", href: styles },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Analytics>
        <Outlet />
      </Analytics>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
