import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_BASE_URL || "http://localhost:3000"),
  title: { default: "Sverigeklättraren", template: "%s — Sverigeklättraren" },
  description: "En modern, öppen och källspårbar klätterförare för Sverige.",
  icons: { icon: "/logo.svg", shortcut: "/logo.svg" },
  openGraph: {
    type: "website",
    locale: "sv_SE",
    title: "Sverigeklättraren",
    description: "Öppen klätterkunskap — områden, leder, access och spårbara källor.",
    images: [{ url: "/opengraph-image", alt: "Sverigeklättraren — öppen klätterkunskap från Sverigeföraren" }],
  },
  twitter: { card: "summary_large_image", images: ["/opengraph-image"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="sv">
      <body>{children}</body>
    </html>
  );
}
