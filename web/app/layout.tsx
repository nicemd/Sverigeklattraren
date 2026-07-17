import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_BASE_URL || "http://localhost:3000"),
  title: { default: "Sverigeföraren", template: "%s — Sverigeföraren" },
  description: "En modern, öppen och källspårbar klätterförare för Sverige.",
  icons: { icon: "/logo.png", shortcut: "/logo.png" },
  openGraph: {
    type: "website",
    locale: "sv_SE",
    title: "Sverigeföraren",
    description: "Öppen klätterkunskap — områden, leder, access och spårbara källor.",
    images: [{ url: "/og.png", alt: "Sverigeföraren — öppen klätterkunskap" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="sv">
      <body>{children}</body>
    </html>
  );
}
