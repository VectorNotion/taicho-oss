import type { CustomBlockDefinition, MergeTag } from "@templatical/types";

export const SLOT_NAMES = ["hero", "body", "cta"] as const;
export type SlotName = (typeof SLOT_NAMES)[number];

/** Custom block type to the exact marker emitted into derived MJML. */
export const SLOT_MARKERS_BY_TYPE: Record<string, string> = {
  "slot-hero": "{{{slots.hero}}}",
  "slot-body": "{{{slots.body}}}",
  "slot-cta": "{{{slots.cta}}}",
  "unsubscribe-footer":
    `<p style="font-size:12px;line-height:1.5;color:#8898aa;text-align:center;">` +
    `You are receiving this because you signed up. ` +
    `<a href="{{{unsubscribeUrl}}}" style="color:#8898aa;">Unsubscribe</a></p>`,
};

const SLOT_HINTS: Record<SlotName, string> = {
  hero: "Headline copy from the winning content variant lands here.",
  body: "Body copy from the content variant lands here.",
  cta: "Call-to-action from the content variant lands here.",
};

function slotDefinition(slot: SlotName): CustomBlockDefinition {
  return {
    type: `slot-${slot}`,
    name: `${slot[0].toUpperCase()}${slot.slice(1)} slot`,
    description: "Filled by a content variant at send time",
    fields: [
      { key: "label", label: "Slot", type: "text", default: `${slot.toUpperCase()} SLOT`, readOnly: true },
      { key: "hint", label: "Hint", type: "text", default: SLOT_HINTS[slot], readOnly: true },
    ],
    template:
      `<div style="border:1.5px dashed #a1a1b5;border-radius:8px;padding:20px;text-align:center;` +
      `font-family:Arial,sans-serif;color:#71717f;background:#f7f7f9;">` +
      `<strong style="letter-spacing:0.05em;">{{ label }}</strong>` +
      `<div style="font-size:12px;margin-top:6px;">{{ hint }}</div></div>`,
  };
}

export function designerBlockDefinitions(): CustomBlockDefinition[] {
  return [
    ...SLOT_NAMES.map(slotDefinition),
    {
      type: "unsubscribe-footer",
      name: "Unsubscribe footer",
      description: "Required footer with the one-click unsubscribe link",
      fields: [
        {
          key: "note",
          label: "Line",
          type: "text",
          default: "You are receiving this because you signed up.",
          readOnly: true,
        },
      ],
      template:
        `<p style="font-size:12px;line-height:1.5;color:#8898aa;text-align:center;">` +
        `{{ note }} <a href="#" style="color:#8898aa;">Unsubscribe</a></p>`,
    },
  ];
}

export const DESIGNER_PALETTE: string[] = [
  "custom:slot-hero",
  "custom:slot-body",
  "custom:slot-cta",
  "custom:unsubscribe-footer",
  "section",
  "title",
  "paragraph",
  "image",
  "button",
  "divider",
  "spacer",
  "social",
  "html",
];

export const DESIGNER_MERGE_TAGS: MergeTag[] = [
  { label: "Contact email", value: "{{contact.email}}", group: "Contact" },
  { label: "Preheader text", value: "{{preheader}}", group: "Email" },
];
