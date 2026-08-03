# Taicho public documentation

This directory owns the public Taicho product documentation. Its four initial
MDX pages were migrated from the `docs/content` directory in the separate
`websites` repository at source commit
`c4030f40706c650a1a0dbe87277985e5a7728ff3`.

Frontmatter records page metadata, section ordering, and navigation order.
Level-two and level-three Markdown headings provide stable page anchors.

The `@content-automation/docs-app` workspace renders these files. Every push to
`main` publishes the docs image with the same immutable commit tag as the
product services and rolls it into staging. A published GitHub Release promotes
that exact staged image to production.
