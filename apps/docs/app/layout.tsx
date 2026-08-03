import type { Metadata } from "next";
import { DocsShell } from "@/components/docs-shell";
import { getDocumentationNavigation } from "@/lib/docs";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://docs.taicho.ai"),
  title: {
    default: "Taicho Documentation",
    template: "%s | Taicho Documentation",
  },
  description:
    "Learn how to connect data, create leads through APIs, and operate Taicho.",
  robots: { follow: true, index: true },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className="dark" lang="en">
      <body>
        <DocsShell navigation={getDocumentationNavigation()}>
          {children}
        </DocsShell>
      </body>
    </html>
  );
}
