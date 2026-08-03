import type { HTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { CircleCheckBig, Info, TriangleAlert } from "lucide-react";
import { slugify } from "@/lib/docs";

function textContent(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(textContent).join("");
  }
  if (value && typeof value === "object" && "props" in value) {
    return textContent(
      (value as { props: { children?: ReactNode } }).props.children,
    );
  }
  return "";
}

export function Callout({
  children,
  title,
  tone = "info",
}: {
  children: ReactNode;
  title: string;
  tone?: "info" | "success" | "warning";
}) {
  const Icon =
    tone === "success"
      ? CircleCheckBig
      : tone === "warning"
        ? TriangleAlert
        : Info;

  return (
    <aside className={`docs-callout docs-callout-${tone}`}>
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div>
        <p className="docs-callout-title">{title}</p>
        <div className="docs-callout-content">{children}</div>
      </div>
    </aside>
  );
}

export function DocumentationLink({
  children,
  href = "",
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (href.startsWith("/")) {
    return (
      <Link href={href} {...props}>
        {children}
      </Link>
    );
  }
  return (
    <a
      href={href}
      rel={href.startsWith("http") ? "noreferrer" : undefined}
      target={href.startsWith("http") ? "_blank" : undefined}
      {...props}
    >
      {children}
    </a>
  );
}

export function DocumentationHeading({
  children,
  level,
}: {
  children: ReactNode;
  level: 2 | 3;
}) {
  const id = slugify(textContent(children));
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <Heading id={id}>
      {children}
      <a aria-label={`Link to ${textContent(children)}`} href={`#${id}`}>
        #
      </a>
    </Heading>
  );
}

export const mdxComponents = {
  a: DocumentationLink,
  Callout,
  h2: ({ children }: HTMLAttributes<HTMLHeadingElement>) => (
    <DocumentationHeading level={2}>{children}</DocumentationHeading>
  ),
  h3: ({ children }: HTMLAttributes<HTMLHeadingElement>) => (
    <DocumentationHeading level={3}>{children}</DocumentationHeading>
  ),
};
