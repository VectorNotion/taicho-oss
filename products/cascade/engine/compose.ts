import Handlebars from "handlebars";
import mjml2html from "mjml";
import { assetsInCascade, databaseFor } from "@content-automation/database";
import type { Pool } from "pg";
import postcss, { type Container } from "postcss";
import parseCssValue from "postcss-value-parser";
import sanitizeHtml from "sanitize-html";
import type { Contact } from "../domain/types";
import { cacheCompiledTemplate, getEmailBundle } from "../data/email-repository";
import { signToken } from "./tokens";

export interface ComposedEmail {
  subject: string;
  html: string;
  text: string;
  from: string;
  headers: Record<string, string>;
}

export function publicUrl(): string {
  return process.env.CASCADE_PUBLIC_URL ?? "http://localhost:3010";
}

// Inline bodies are authored by us (step config), so raw HTML is allowed.
const INLINE_SHELL = Handlebars.compile(
  `<html><body><p>{{{body}}}</p><p><a href="{{{unsubscribeUrl}}}">Unsubscribe</a></p></body></html>`,
);

function htmlToText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, " ")
    .trim();
}

/** Rewrite external links to signed click-redirects; skip unsubscribe links. */
function rewriteLinks(
  html: string,
  sendId: string,
  interestUrl: string | null,
  organizationId: string,
): string {
  return html.replace(/href="(https?:\/\/[^"]+)"/g, (match, url: string) => {
    if (url.startsWith(`${publicUrl()}/u/`)) return match;
    const payload: Record<string, unknown> = {
      t: "click",
      s: sendId,
      u: url,
      o: organizationId,
    };
    if (interestUrl && url === interestUrl) payload.i = 1;
    return `href="${publicUrl()}/c/${signToken(payload)}"`;
  });
}

function appendOpenPixel(html: string, sendId: string, organizationId: string): string {
  const pixel = `<img src="${publicUrl()}/o/${signToken({
    t: "open",
    s: sendId,
    o: organizationId,
  })}" width="1" height="1" alt="" />`;
  return html.includes("</body>") ? html.replace("</body>", `${pixel}</body>`) : html + pixel;
}

async function loadAssetsMap(pool: Pool): Promise<Record<string, { title: string; url: string }>> {
  const rows = await databaseFor(pool)
    .select({ sourceId: assetsInCascade.source_id, title: assetsInCascade.title, url: assetsInCascade.url })
    .from(assetsInCascade);
  const map: Record<string, { title: string; url: string }> = {};
  for (const row of rows) map[row.sourceId] = { title: row.title, url: row.url };
  return map;
}

const PREVIEW_CONTEXT = {
  contact: { email: "lead@example.com", attributes: { firstName: "Sam", company: "ExampleCorp" } },
  preheader: "Preview preheader",
  assets: {},
  unsubscribeUrl: "https://example.com/u/preview",
};

const PREVIEW_CSP =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'\">";

function removeNetworkCss(container: Container): void {
  container.walkAtRules((rule) => {
    if (rule.name.toLowerCase() === "import") rule.remove();
  });
  container.walkDecls((declaration) => {
    let networkCapable = false;
    parseCssValue(declaration.value).walk((node) => {
      if (
        node.type === "function" &&
        ["expression", "url"].includes(node.value.toLowerCase())
      ) {
        networkCapable = true;
        return false;
      }
      return undefined;
    });
    if (networkCapable) declaration.remove();
  });
}

function stylesheetCanLoadNetworkResource(source: string): boolean {
  try {
    const root = postcss.parse(source);
    let unsafe = false;
    root.walkAtRules((rule) => {
      if (rule.name.toLowerCase() === "import") unsafe = true;
    });
    root.walkDecls((declaration) => {
      parseCssValue(declaration.value).walk((node) => {
        if (
          node.type === "function" &&
          ["expression", "url"].includes(node.value.toLowerCase())
        ) {
          unsafe = true;
          return false;
        }
        return undefined;
      });
    });
    return unsafe;
  } catch {
    return true;
  }
}

function sanitizeStyleAttribute(source: string): string {
  try {
    const root = postcss.parse(`preview{${source}}`);
    const rule = root.first;
    if (!rule || rule.type !== "rule") return "";
    removeNetworkCss(rule);
    return rule.nodes?.map((node) => node.toString()).join(";") ?? "";
  } catch {
    return "";
  }
}

/**
 * Preview documents are untrusted author/model output. Keep the email markup
 * visible without executing code, submitting forms, or making remote requests
 * that leak the operator's IP or create noisy CSP violations.
 */
export function sanitizePreviewHtml(source: string): string {
  const markup = sanitizeHtml(source, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "center",
      "img",
      "style",
    ],
    allowedAttributes: {
      "*": [
        "align",
        "bgcolor",
        "border",
        "cellpadding",
        "cellspacing",
        "class",
        "dir",
        "height",
        "id",
        "role",
        "style",
        "valign",
        "width",
      ],
      a: ["href", "name", "rel", "target", "title"],
      img: ["alt", "height", "src", "title", "width"],
      table: ["summary"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan", "scope"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["data"] },
    allowProtocolRelative: false,
    allowVulnerableTags: true,
    enforceHtmlBoundary: true,
    exclusiveFilter: (frame) =>
      frame.tag === "style" && stylesheetCanLoadNetworkResource(frame.text),
    transformTags: {
      "*": (tagName, attributes) => ({
        tagName,
        attribs: {
          ...attributes,
          ...(attributes.style
            ? { style: sanitizeStyleAttribute(attributes.style) }
            : {}),
        },
      }),
    },
  });
  return `<!doctype html><html><head>${PREVIEW_CSP}</head><body>${markup}</body></html>`;
}

/** Author-time preview: compile MJML + Handlebars with sample contact data. */
export async function renderPreview(
  mjmlSource: string,
  slots: Record<string, string>,
): Promise<{ html: string | null; errors: string[] }> {
  try {
    const compiled = await mjml2html(mjmlSource, { validationLevel: "soft" });
    const errors = (compiled.errors ?? []).map(
      (e: { line?: number; message?: string }) => `line ${e.line ?? "?"}: ${e.message ?? "invalid MJML"}`,
    );
    const renderedSlots: Record<string, string> = {};
    for (const [key, value] of Object.entries(slots)) {
      renderedSlots[key] = Handlebars.compile(String(value ?? ""))(PREVIEW_CONTEXT);
    }
    const html = Handlebars.compile(compiled.html)({ ...PREVIEW_CONTEXT, slots: renderedSlots });
    return { html: sanitizePreviewHtml(html), errors };
  } catch (err) {
    return { html: null, errors: [err instanceof Error ? err.message : "Preview failed"] };
  }
}

export async function composeSend(
  pool: Pool,
  args: {
    sendId: string;
    organizationId?: string;
    emailId?: string;
    inline?: { subject: string; body: string };
    contact: Contact;
  },
): Promise<ComposedEmail> {
  const organizationId = args.organizationId
    ?? process.env.CASCADE_ORGANIZATION_ID
    ?? "legacy";
  const unsubscribeUrl = `${publicUrl()}/u/${signToken({
    t: "unsub",
    c: args.contact.id,
    o: organizationId,
  })}`;
  const headers: Record<string, string> = {
    "List-Unsubscribe": `<${unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };

  if (args.emailId) {
    const bundle = await getEmailBundle(pool, args.emailId);
    if (!bundle) throw new Error(`email ${args.emailId} not found`);

    let compiled = bundle.compiledHtml;
    if (!compiled) {
      const result = await mjml2html(bundle.templateMjml, { validationLevel: "soft" });
      compiled = result.html;
      await cacheCompiledTemplate(pool, bundle.email.templateId, compiled);
    }

    const assets = await loadAssetsMap(pool);
    const baseContext = {
      contact: { email: args.contact.email, attributes: args.contact.attributes },
      preheader: bundle.preheader,
      assets,
      unsubscribeUrl,
    };
    // Slots render first so they can use the same context (e.g. {{assets.x.url}}).
    const slots: Record<string, string> = {};
    for (const [key, value] of Object.entries(bundle.slots)) {
      slots[key] = Handlebars.compile(value)(baseContext);
    }
    const context = { ...baseContext, slots };
    let html = Handlebars.compile(compiled)(context);
    const subject = Handlebars.compile(bundle.subject)(context);
    html = appendOpenPixel(
      rewriteLinks(html, args.sendId, bundle.email.interestUrl, organizationId),
      args.sendId,
      organizationId,
    );
    return {
      subject,
      html,
      text: htmlToText(html),
      from: bundle.email.fromName
        ? `${bundle.email.fromName} <${bundle.email.fromEmail}>`
        : bundle.email.fromEmail,
      headers,
    };
  }

  if (!args.inline) throw new Error("composeSend needs emailId or inline content");
  let html = INLINE_SHELL({ body: args.inline.body, unsubscribeUrl });
  html = appendOpenPixel(
    rewriteLinks(html, args.sendId, null, organizationId),
    args.sendId,
    organizationId,
  );
  return {
    subject: args.inline.subject,
    html,
    text: htmlToText(html),
    from: process.env.CASCADE_FROM_EMAIL ?? "cascade@example.com",
    headers,
  };
}
