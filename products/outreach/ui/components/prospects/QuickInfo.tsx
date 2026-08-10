"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Mail,
  Phone,
  Linkedin,
  Twitter,
  Youtube,
  Instagram,
  Facebook,
  Globe,
  Copy,
  Check,
  ExternalLink,
} from "lucide-react";
import type { Prospect } from "@/products/outreach/domain/types";

interface QuickInfoProps {
  prospect: Prospect;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="h-3 w-3 text-chart-2" />
          ) : (
            <Copy className="h-3 w-3 text-muted-foreground" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : `Copy ${label}`}</TooltipContent>
    </Tooltip>
  );
}

function SocialLink({
  url,
  icon: Icon,
  label,
  color,
}: {
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  color: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="p-2 rounded-md hover:bg-muted transition-colors inline-flex"
        >
          <Icon className={`h-5 w-5 ${color}`} />
        </a>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function QuickInfo({ prospect }: QuickInfoProps) {
  const hasContact = prospect.email || prospect.phone;
  const hasSocial =
    prospect.linkedinUrl ||
    prospect.twitterUrl ||
    prospect.youtubeUrl ||
    prospect.instagramUrl ||
    prospect.facebookUrl ||
    prospect.websiteUrl;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick info</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Contact Info */}
        {hasContact && (
          <div className="space-y-2">
            {prospect.email && (
              <div className="flex items-center justify-between group">
                <div className="flex items-center gap-2 min-w-0">
                  <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                  <a
                    href={`mailto:${prospect.email}`}
                    className="text-sm hover:underline truncate"
                  >
                    {prospect.email}
                  </a>
                </div>
                <CopyButton value={prospect.email} label="email" />
              </div>
            )}
            {prospect.phone && (
              <div className="flex items-center justify-between group">
                <div className="flex items-center gap-2 min-w-0">
                  <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                  <a
                    href={`tel:${prospect.phone}`}
                    className="text-sm hover:underline truncate"
                  >
                    {prospect.phone}
                  </a>
                </div>
                <CopyButton value={prospect.phone} label="phone" />
              </div>
            )}
          </div>
        )}

        {/* Social Links as Icons */}
        {hasSocial && (
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground mb-2">Profiles</p>
            <div className="flex items-center gap-1 flex-wrap">
              {prospect.linkedinUrl && (
                <SocialLink
                  url={prospect.linkedinUrl}
                  icon={Linkedin}
                  label="LinkedIn"
                  color="text-muted-foreground"
                />
              )}
              {prospect.twitterUrl && (
                <SocialLink
                  url={prospect.twitterUrl}
                  icon={Twitter}
                  label="Twitter"
                  color="text-muted-foreground"
                />
              )}
              {prospect.youtubeUrl && (
                <SocialLink
                  url={prospect.youtubeUrl}
                  icon={Youtube}
                  label="YouTube"
                  color="text-muted-foreground"
                />
              )}
              {prospect.instagramUrl && (
                <SocialLink
                  url={prospect.instagramUrl}
                  icon={Instagram}
                  label="Instagram"
                  color="text-muted-foreground"
                />
              )}
              {prospect.facebookUrl && (
                <SocialLink
                  url={prospect.facebookUrl}
                  icon={Facebook}
                  label="Facebook"
                  color="text-muted-foreground"
                />
              )}
              {prospect.websiteUrl && (
                <SocialLink
                  url={prospect.websiteUrl}
                  icon={Globe}
                  label="Website"
                  color="text-muted-foreground"
                />
              )}
            </div>
          </div>
        )}

        {/* Details */}
        <div className="pt-2 border-t">
          <p className="text-xs text-muted-foreground mb-2">Details</p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Source</p>
              <p className="font-medium capitalize text-xs">
                {prospect.source.replace("_", " ")}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Added</p>
              <p className="font-medium text-xs">
                {new Date(prospect.createdAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </p>
            </div>
          </div>
        </div>

        {/* Tags */}
        {prospect.tags && prospect.tags.length > 0 && (
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground mb-2">Tags</p>
            <div className="flex flex-wrap gap-1">
              {prospect.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs bg-secondary px-2 py-0.5 rounded"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {!hasContact && !hasSocial && (
          <p className="text-sm text-muted-foreground">No contact information</p>
        )}
      </CardContent>
    </Card>
  );
}
