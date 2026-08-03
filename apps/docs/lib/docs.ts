import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

export interface DocumentationFrontmatter {
  description: string;
  eyebrow?: string;
  order: number;
  section: string;
  sectionOrder: number;
  title: string;
}

export interface DocumentationHeading {
  depth: 2 | 3;
  id: string;
  title: string;
}

export interface DocumentationDocument extends DocumentationFrontmatter {
  headings: DocumentationHeading[];
  href: string;
  slug: string;
  slugSegments: string[];
  source: string;
}

function existingDirectory(candidates: string[]) {
  const directory = candidates.find((candidate) => fs.existsSync(candidate));
  if (!directory) {
    throw new Error(
      `Documentation content directory was not found. Checked: ${candidates.join(", ")}`,
    );
  }
  return directory;
}

export const contentDirectory = existingDirectory([
  ...(process.env.DOCS_CONTENT_DIR
    ? [path.resolve(process.env.DOCS_CONTENT_DIR)]
    : []),
  path.resolve(process.cwd(), "../../docs/content"),
  path.resolve(process.cwd(), "docs/content"),
  path.resolve(process.cwd(), "content"),
]);

export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function headingText(value: string) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+#+\s*$/, "")
    .trim();
}

function extractHeadings(source: string): DocumentationHeading[] {
  const headings: DocumentationHeading[] = [];
  let inCodeFence = false;

  for (const line of source.split("\n")) {
    if (line.trim().startsWith("```")) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    const match = /^(#{2,3})\s+(.+)$/.exec(line);
    if (!match) continue;

    const title = headingText(match[2]);
    headings.push({
      depth: match[1].length as 2 | 3,
      id: slugify(title),
      title,
    });
  }

  return headings;
}

function requiredNumber(value: unknown, field: string, fileName: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a number in ${fileName}`);
  }
  return value;
}

function requiredString(value: unknown, field: string, fileName: string) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string in ${fileName}`);
  }
  return value.trim();
}

function loadDocument(fileName: string): DocumentationDocument {
  const filePath = path.join(contentDirectory, fileName);
  const parsed = matter(fs.readFileSync(filePath, "utf8"));
  const slug = fileName.replace(/\.mdx$/, "");
  const slugSegments = slug === "index" ? [] : slug.split("/");
  const href = slugSegments.length === 0 ? "/" : `/${slugSegments.join("/")}`;

  return {
    title: requiredString(parsed.data.title, "title", fileName),
    description: requiredString(
      parsed.data.description,
      "description",
      fileName,
    ),
    eyebrow:
      typeof parsed.data.eyebrow === "string"
        ? parsed.data.eyebrow.trim()
        : undefined,
    section: requiredString(parsed.data.section, "section", fileName),
    sectionOrder: requiredNumber(
      parsed.data.sectionOrder,
      "sectionOrder",
      fileName,
    ),
    order: requiredNumber(parsed.data.order, "order", fileName),
    headings: extractHeadings(parsed.content),
    href,
    slug,
    slugSegments,
    source: parsed.content,
  };
}

function contentFiles(directory = contentDirectory, prefix = ""): string[] {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) {
        return contentFiles(path.join(directory, entry.name), relativePath);
      }
      return entry.isFile() && entry.name.endsWith(".mdx")
        ? [relativePath]
        : [];
    });
}

export function getAllDocumentation(): DocumentationDocument[] {
  return contentFiles()
    .map(loadDocument)
    .sort(
      (left, right) =>
        left.sectionOrder - right.sectionOrder ||
        left.order - right.order ||
        left.title.localeCompare(right.title),
    );
}

export function getDocumentationDocument(slugSegments: string[] = []) {
  const slug = slugSegments.length === 0 ? "index" : slugSegments.join("/");
  return getAllDocumentation().find((document) => document.slug === slug);
}

export function getDocumentationNavigation() {
  const sections = new Map<
    string,
    Array<{ href: string; order: number; title: string }>
  >();

  for (const document of getAllDocumentation()) {
    const items = sections.get(document.section) ?? [];
    items.push({
      href: document.href,
      order: document.order,
      title: document.title,
    });
    sections.set(document.section, items);
  }

  const integrations = sections.get("Integrations") ?? [];
  if (!integrations.some((item) => item.href === "/api-reference")) {
    integrations.push({
      href: "/api-reference",
      order: 1,
      title: "API reference",
    });
  }
  sections.set("Integrations", integrations);

  return Array.from(sections, ([title, items]) => ({
    title,
    items: items
      .sort((left, right) => left.order - right.order)
      .map(({ href, title: itemTitle }) => ({
        href,
        title: itemTitle,
      })),
  }));
}

export function getDocumentationNeighbors(href: string) {
  const documents = getAllDocumentation();
  const index = documents.findIndex((document) => document.href === href);

  return {
    previousPage:
      index > 0
        ? {
            href: documents[index - 1].href,
            title: documents[index - 1].title,
          }
        : undefined,
    nextPage:
      index >= 0 && index < documents.length - 1
        ? {
            href: documents[index + 1].href,
            title: documents[index + 1].title,
          }
        : undefined,
  };
}
