"use client";

import { useEffect } from "react";
import { useEditor, EditorContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import { marked } from "marked";
import TurndownService from "turndown";
import { cn } from "@/lib/utils";

/**
 * Markdown ⇄ HTML converters for the editor boundary. The editor's model is
 * ProseMirror; these translate at the edges so agents (which emit markdown)
 * and platform adapters (which want markdown/plain text) never see HTML.
 * Client-side only — turndown needs a DOM.
 */
export function markdownToHtml(markdown: string): string {
  return marked.parse(markdown, { async: false, gfm: true, breaks: false });
}

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
});

export function htmlToMarkdown(html: string): string {
  // Turndown pads list markers ("-   item"); normalize to the single space
  // agents and stored drafts use, without touching nesting indentation.
  return turndown.turndown(html).replace(/^([ \t]*(?:[-*+]|\d+\.))[ \t]+/gm, "$1 ");
}
import { Button } from "./button";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Link as LinkIcon,
  Undo,
  Redo,
} from "lucide-react";

interface RichTextEditorProps {
  content?: string;
  onChange?: (content: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
  /**
   * Serialization format at the component boundary. "html" (default) keeps the
   * existing contract; "markdown" parses `content` as markdown and emits
   * markdown from `onChange` — the round-trip for agent-generated drafts.
   */
  format?: "html" | "markdown";
}

function MenuBar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;

  return (
    <div className="flex items-center gap-1 p-1 border-b bg-muted/30">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn("h-7 w-7 p-0", editor.isActive("bold") && "bg-muted")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn("h-7 w-7 p-0", editor.isActive("italic") && "bg-muted")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="h-3.5 w-3.5" />
      </Button>
      <div className="w-px h-4 bg-border mx-1" />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn("h-7 w-7 p-0", editor.isActive("bulletList") && "bg-muted")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn("h-7 w-7 p-0", editor.isActive("orderedList") && "bg-muted")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </Button>
      <div className="w-px h-4 bg-border mx-1" />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn("h-7 w-7 p-0", editor.isActive("link") && "bg-muted")}
        onClick={() => {
          const url = window.prompt("Enter URL:");
          if (url) {
            editor.chain().focus().setLink({ href: url }).run();
          }
        }}
      >
        <LinkIcon className="h-3.5 w-3.5" />
      </Button>
      <div className="flex-1" />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
      >
        <Undo className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
      >
        <Redo className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function RichTextEditor({
  content = "",
  onChange,
  placeholder = "Write something...",
  className,
  minHeight = "120px",
  format = "html",
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder,
        emptyEditorClass: "is-editor-empty",
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-primary underline",
        },
      }),
    ],
    content: format === "markdown" && content ? markdownToHtml(content) : content,
    immediatelyRender: false, // Fix SSR hydration mismatch
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange?.(format === "markdown" ? htmlToMarkdown(html) : html);
    },
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-sm dark:prose-invert max-w-none focus:outline-none p-3",
          "prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0"
        ),
        style: `min-height: ${minHeight}`,
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    const next = format === "markdown" && content ? markdownToHtml(content) : content;
    const current = editor.getHTML();
    const normalizedNext = next || "<p></p>";
    if (current !== normalizedNext) editor.commands.setContent(next, { emitUpdate: false });
  }, [content, editor, format]);

  return (
    <div
      className={cn(
        "rounded-md border bg-background overflow-hidden",
        "focus-within:ring-1 focus-within:ring-ring",
        className
      )}
    >
      <MenuBar editor={editor} />
      <EditorContent editor={editor} />
      <style jsx global>{`
        .tiptap p.is-editor-empty:first-child::before {
          color: hsl(var(--muted-foreground));
          content: attr(data-placeholder);
          float: left;
          height: 0;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}

// Simple hook to get plain text from HTML
export function getPlainText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || div.innerText || "";
}
