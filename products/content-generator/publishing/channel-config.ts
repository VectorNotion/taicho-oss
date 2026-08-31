import { z } from "zod";

const channelName = z.string().trim().min(1, "A channel name is required.").max(300);
const credential = z.string().trim().min(1, "A credential value is required.").max(10_000);

export const publishingHttpUrl = z.string().trim().min(1).max(2_048).superRefine((value, context) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      context.addIssue({ code: "custom", message: "Enter an HTTP or HTTPS URL." });
    }
  } catch {
    context.addIssue({ code: "custom", message: "Enter a valid HTTP or HTTPS URL." });
  }
});

export const publishingChannelInputSchema = z.discriminatedUnion("destination", [
  z.object({
    destination: z.literal("cms"),
    name: channelName,
    credentials: z.object({
      base_url: publishingHttpUrl,
      api_key: credential,
    }).strict(),
    extra: z.record(z.string(), z.unknown()).default({}),
  }),
  z.object({
    destination: z.literal("webhook"),
    name: channelName,
    credentials: z.object({
      url: publishingHttpUrl,
      secret: credential,
    }).strict(),
    extra: z.record(z.string(), z.unknown()).default({}),
  }),
]);

export type PublishingChannelInput = z.infer<typeof publishingChannelInputSchema>;

export function isValidPublishingHttpUrl(value: string): boolean {
  return publishingHttpUrl.safeParse(value).success;
}
