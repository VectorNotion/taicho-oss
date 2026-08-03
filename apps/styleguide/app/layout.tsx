import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { StyleguideNav } from "../components/styleguide-nav";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Vector Notion · Design language",
  description: "The living demo of docs/design-language.md — every construct, rendered with the real components",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <div className="min-h-screen">
          <StyleguideNav />
          <main className="ml-16 min-h-screen bg-background p-8 max-md:p-4 md:ml-[248px]">{children}</main>
        </div>
        <Toaster position="bottom-right" richColors theme="dark" />
      </body>
    </html>
  );
}
