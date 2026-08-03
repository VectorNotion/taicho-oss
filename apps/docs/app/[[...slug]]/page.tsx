import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import { mdxComponents } from "@/components/mdx";
import {
  getAllDocumentation,
  getDocumentationDocument,
  getDocumentationNeighbors,
} from "@/lib/docs";

interface DocumentationPageProps {
  params: Promise<{ slug?: string[] }>;
}

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return getAllDocumentation().map((document) => ({
    slug: document.slugSegments,
  }));
}

export async function generateMetadata({
  params,
}: DocumentationPageProps): Promise<Metadata> {
  const { slug } = await params;
  const document = getDocumentationDocument(slug);
  if (!document) return {};

  return {
    title: document.title,
    description: document.description,
    alternates: { canonical: document.href },
  };
}

export default async function DocumentationPage({
  params,
}: DocumentationPageProps) {
  const { slug } = await params;
  const document = getDocumentationDocument(slug);
  if (!document) notFound();

  const { nextPage, previousPage } = getDocumentationNeighbors(document.href);

  return (
    <div className="grid gap-12 xl:grid-cols-[minmax(0,1fr)_12rem]">
      <article className="min-w-0 max-w-3xl">
        <header className="mb-10 border-b border-border pb-8">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-primary">
            {document.eyebrow ?? document.section}
          </p>
          <h1 className="font-heading text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            {document.title}
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-muted-foreground">
            {document.description}
          </p>
        </header>

        <div className="docs-copy">
          <MDXRemote
            components={mdxComponents}
            options={{
              mdxOptions: {
                remarkPlugins: [remarkGfm],
              },
            }}
            source={document.source}
          />
        </div>

        <nav
          aria-label="Adjacent documentation pages"
          className="mt-12 grid gap-3 border-t border-border pt-6 sm:grid-cols-2"
        >
          {previousPage ? (
            <Link
              className="docs-neighbor"
              href={previousPage.href}
              rel="prev"
            >
              <ArrowLeft className="size-4" />
              <span>
                <small>Previous</small>
                {previousPage.title}
              </span>
            </Link>
          ) : (
            <span />
          )}
          {nextPage ? (
            <Link
              className="docs-neighbor justify-end text-right"
              href={nextPage.href}
              rel="next"
            >
              <span>
                <small>Next</small>
                {nextPage.title}
              </span>
              <ArrowRight className="size-4" />
            </Link>
          ) : null}
        </nav>
      </article>

      {document.headings.length > 0 ? (
        <aside className="hidden xl:block">
          <nav
            aria-label="On this page"
            className="sticky top-24 border-l border-border pl-5"
          >
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-foreground">
              On this page
            </p>
            <div className="grid gap-2">
              {document.headings.map((heading) => (
                <a
                  className={`text-xs leading-5 text-muted-foreground transition-colors hover:text-foreground ${
                    heading.depth === 3 ? "pl-3" : ""
                  }`}
                  href={`#${heading.id}`}
                  key={`${heading.depth}-${heading.id}`}
                >
                  {heading.title}
                </a>
              ))}
            </div>
          </nav>
        </aside>
      ) : null}
    </div>
  );
}
