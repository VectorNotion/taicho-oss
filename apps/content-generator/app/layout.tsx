import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { getAuthorizationContext } from "@content-automation/auth/server";
import { canOpenAdmin } from "@content-automation/auth/permissions";
import { headers } from "next/headers";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ProductSidebar } from "../components/product-sidebar";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Content Generator",
  description: "AI-assisted content research and generation",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const context = await getAuthorizationContext(await headers());
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {context ? <SidebarProvider>
          <ProductSidebar canAdmin={canOpenAdmin(context.role)} />
          <SidebarInset><main className="min-w-0 p-4 md:p-8">{children}</main></SidebarInset>
        </SidebarProvider> : children}
        <Toaster position="bottom-right" richColors theme="dark" />
      </body>
    </html>
  );
}
