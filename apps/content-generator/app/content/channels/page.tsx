"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { ListRow, ListRows } from "@/components/ListRow";
import { FilterSelect, ListSurface } from "@/components/ListSurface";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Loader2, Plug, Plus, Radio, Unlink, Webhook } from "lucide-react";

interface ChannelSummary {
  id: string;
  destination: string;
  name: string;
  credentialKind: string;
  tokenExpiry: string | null;
  extra: Record<string, unknown>;
}

interface DestinationInfo {
  destination: string;
  credentialKind: string;
  oauthCapable: boolean;
  requiresMedia: boolean;
}

const destinationLabels: Record<string, string> = {
  youtube: "YouTube",
  x: "X",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  cms: "CMS",
  webhook: "Webhook",
};

function labelFor(destination: string): string {
  return destinationLabels[destination] ?? destination;
}

function tokenHealth(tokenExpiry: string | null): {
  label: string;
  variant: "default" | "secondary" | "outline" | "destructive";
} {
  if (!tokenExpiry) return { label: "Non-expiring", variant: "outline" };
  const expiry = new Date(tokenExpiry).getTime();
  const now = Date.now();
  if (expiry <= now) return { label: "Needs attention", variant: "destructive" };
  if (expiry <= now + 24 * 60 * 60 * 1000) return { label: "Expiring", variant: "secondary" };
  return { label: "Fresh", variant: "default" };
}

function extraSummary(extra: Record<string, unknown>): string {
  return Object.values(extra ?? {})
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" · ");
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [destinations, setDestinations] = useState<DestinationInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [healthFilter, setHealthFilter] = useState<"all" | "healthy" | "attention">("all");
  const [destinationFilter, setDestinationFilter] = useState("all");

  // Add CMS dialog state
  const [cmsDialogOpen, setCmsDialogOpen] = useState(false);
  const [cmsName, setCmsName] = useState("");
  const [cmsBaseUrl, setCmsBaseUrl] = useState("");
  const [cmsApiKey, setCmsApiKey] = useState("");
  const [cmsLoading, setCmsLoading] = useState(false);

  // Add webhook dialog state
  const [webhookDialogOpen, setWebhookDialogOpen] = useState(false);
  const [webhookName, setWebhookName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [webhookLoading, setWebhookLoading] = useState(false);

  // Disconnect confirmation state
  const [disconnectTarget, setDisconnectTarget] = useState<ChannelSummary | null>(null);
  const [disconnectLoading, setDisconnectLoading] = useState(false);

  const fetchChannels = async () => {
    try {
      const response = await fetch("/api/content/channels");
      if (!response.ok) throw new Error("Failed to fetch channels");
      const data = await response.json();
      setChannels(data.channels ?? []);
      setDestinations(data.destinations ?? []);
    } catch (error) {
      console.error("Error fetching channels:", error);
      toast.error("Could not load channels. Refresh to try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChannels();
  }, []);

  // Surface the OAuth redirect outcome, then clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");
    if (connected) toast.success(`${labelFor(connected)} connected`);
    if (error === "state") {
      toast.error("The connection could not be verified. Start the connection again.");
    } else if (error) {
      toast.error("Could not connect the channel. Try again.");
    }
    if (connected || error) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const handleAddCms = async () => {
    if (!cmsName || !cmsBaseUrl || !cmsApiKey) return;
    setCmsLoading(true);
    try {
      const response = await fetch("/api/content/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination: "cms",
          name: cmsName.trim(),
          credentials: { base_url: cmsBaseUrl.trim(), api_key: cmsApiKey.trim() },
        }),
      });
      if (!response.ok) throw new Error("Failed to add CMS channel");
      toast.success("CMS channel added");
      setCmsDialogOpen(false);
      setCmsName("");
      setCmsBaseUrl("");
      setCmsApiKey("");
      fetchChannels();
    } catch (error) {
      console.error("Error adding CMS channel:", error);
      toast.error("Could not add the CMS channel. Try again.");
    } finally {
      setCmsLoading(false);
    }
  };

  const handleAddWebhook = async () => {
    if (!webhookName || !webhookUrl || !webhookSecret) return;
    setWebhookLoading(true);
    try {
      const response = await fetch("/api/content/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination: "webhook",
          name: webhookName.trim(),
          // The webhook adapter reads credentials.url and credentials.secret.
          credentials: { url: webhookUrl.trim(), secret: webhookSecret.trim() },
        }),
      });
      if (!response.ok) throw new Error("Failed to add webhook channel");
      toast.success("Webhook channel added");
      setWebhookDialogOpen(false);
      setWebhookName("");
      setWebhookUrl("");
      setWebhookSecret("");
      fetchChannels();
    } catch (error) {
      console.error("Error adding webhook channel:", error);
      toast.error("Could not add the webhook channel. Try again.");
    } finally {
      setWebhookLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!disconnectTarget) return;
    setDisconnectLoading(true);
    try {
      const response = await fetch(`/api/content/channels/${disconnectTarget.id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to disconnect channel");
      toast.success("Channel disconnected");
      setDisconnectTarget(null);
      fetchChannels();
    } catch (error) {
      console.error("Error disconnecting channel:", error);
      toast.error("Could not disconnect the channel. Try again.");
    } finally {
      setDisconnectLoading(false);
    }
  };

  const oauthDestinations = destinations.filter((destination) => destination.oauthCapable);
  const hasCms = destinations.some((destination) => destination.destination === "cms");
  const hasWebhook = destinations.some((destination) => destination.destination === "webhook");
  const connectedDestinations = useMemo(
    () => Array.from(new Set(channels.map((channel) => channel.destination))).sort(),
    [channels],
  );
  const filteredChannels = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return channels.filter((channel) => {
      const health = tokenHealth(channel.tokenExpiry);
      const healthGroup = health.variant === "destructive" || health.variant === "secondary"
        ? "attention"
        : "healthy";
      const matchesHealth = healthFilter === "all" || healthGroup === healthFilter;
      const matchesDestination =
        destinationFilter === "all" || channel.destination === destinationFilter;
      const matchesSearch =
        !normalizedQuery ||
        [
          channel.name,
          labelFor(channel.destination),
          channel.credentialKind,
          extraSummary(channel.extra),
          health.label,
        ].some((value) => value.toLowerCase().includes(normalizedQuery));
      return matchesHealth && matchesDestination && matchesSearch;
    });
  }, [channels, destinationFilter, healthFilter, searchQuery]);
  const hasChannelFilters =
    searchQuery.trim().length > 0 ||
    healthFilter !== "all" ||
    destinationFilter !== "all";

  const clearChannelFilters = () => {
    setSearchQuery("");
    setHealthFilter("all");
    setDestinationFilter("all");
  };

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title="Channels"
        description="Destinations connected for publishing Posts"
      />

      <div className="space-y-8">
        {/* Available destinations to connect */}
        {loading ? (
          <div className="flex flex-wrap items-center gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-36" />
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {oauthDestinations.map((destination) => (
              <Button key={destination.destination} variant="outline" asChild>
                <a href={`/api/content/channels/connect/${destination.destination}`}>
                  <Plug className="h-4 w-4" />
                  Connect {labelFor(destination.destination)}
                </a>
              </Button>
            ))}

            {hasCms && (
              <Dialog open={cmsDialogOpen} onOpenChange={setCmsDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <Plus className="h-4 w-4" />
                    Add CMS
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add CMS</DialogTitle>
                    <DialogDescription>
                      Connect a CMS by its API. Posts publish to it with their titles.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="grid gap-2">
                      <Label htmlFor="cms-name">Name</Label>
                      <Input
                        id="cms-name"
                        placeholder="e.g., Company blog"
                        value={cmsName}
                        onChange={(e) => setCmsName(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="cms-base-url">Base URL</Label>
                      <Input
                        id="cms-base-url"
                        placeholder="https://cms.example.com"
                        value={cmsBaseUrl}
                        onChange={(e) => setCmsBaseUrl(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="cms-api-key">API key</Label>
                      <Input
                        id="cms-api-key"
                        type="password"
                        value={cmsApiKey}
                        onChange={(e) => setCmsApiKey(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Stored server-side and sent with each publish request.
                      </p>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setCmsDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      onClick={handleAddCms}
                      disabled={cmsLoading || !cmsName || !cmsBaseUrl || !cmsApiKey}
                    >
                      {cmsLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                      Add CMS
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}

            {hasWebhook && (
              <Dialog open={webhookDialogOpen} onOpenChange={setWebhookDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <Webhook className="h-4 w-4" />
                    Add webhook
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add webhook</DialogTitle>
                    <DialogDescription>
                      Send the full Post as signed JSON to an endpoint you control.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="grid gap-2">
                      <Label htmlFor="webhook-name">Name</Label>
                      <Input
                        id="webhook-name"
                        placeholder="e.g., Internal pipeline"
                        value={webhookName}
                        onChange={(e) => setWebhookName(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="webhook-url">URL</Label>
                      <Input
                        id="webhook-url"
                        placeholder="https://example.com/hooks/content"
                        value={webhookUrl}
                        onChange={(e) => setWebhookUrl(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="webhook-secret">Signing secret</Label>
                      <Input
                        id="webhook-secret"
                        type="password"
                        value={webhookSecret}
                        onChange={(e) => setWebhookSecret(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Used to sign each delivery so the receiver can verify it.
                      </p>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setWebhookDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      onClick={handleAddWebhook}
                      disabled={webhookLoading || !webhookName || !webhookUrl || !webhookSecret}
                    >
                      {webhookLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                      Add webhook
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        )}

        {/* Connected channels */}
        <ListSurface
          count={filteredChannels.length}
          description={`${channels.length} publishing ${channels.length === 1 ? "destination" : "destinations"} connected.`}
          emptyState={
            <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
              <Radio className="mb-4 h-8 w-8 text-muted-foreground" />
              <p className="font-medium">
                {hasChannelFilters ? "No channels match these filters" : "No connected channels"}
              </p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                {hasChannelFilters
                  ? "Try another search, destination, or connection status."
                  : "Connect a platform above or add a CMS or webhook."}
              </p>
              {hasChannelFilters ? (
                <Button className="mt-4" onClick={clearChannelFilters} size="sm" variant="outline">
                  Clear filters
                </Button>
              ) : null}
            </div>
          }
          filters={
            <>
              {(["all", "healthy", "attention"] as const).map((status) => (
                <Button
                  key={status}
                  onClick={() => setHealthFilter(status)}
                  size="sm"
                  variant={healthFilter === status ? "secondary" : "ghost"}
                >
                  {status === "all"
                    ? "All"
                    : status === "healthy"
                      ? "Healthy"
                      : "Needs attention"}
                </Button>
              ))}
              <FilterSelect
                label="Destination"
                onValueChange={setDestinationFilter}
                options={[
                  { label: "All destinations", value: "all" },
                  ...connectedDestinations.map((destination) => ({
                    label: labelFor(destination),
                    value: destination,
                  })),
                ]}
                value={destinationFilter}
              />
              {hasChannelFilters ? (
                <Button onClick={clearChannelFilters} size="sm" variant="ghost">
                  Clear
                </Button>
              ) : null}
            </>
          }
          isLoading={loading}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search connected channels…"
          searchValue={searchQuery}
          title="Connected channels"
        >
          {!loading && filteredChannels.length > 0 ? (
            <ListRows>
              {filteredChannels.map((channel) => {
                const health = tokenHealth(channel.tokenExpiry);
                const summary = extraSummary(channel.extra);
                return (
                  <ListRow
                    actions={[{
                      destructive: true,
                      icon: Unlink,
                      label: `Disconnect ${channel.name}`,
                      onSelect: () => setDisconnectTarget(channel),
                    }]}
                    badge={
                      <Badge
                        title={channel.tokenExpiry ? `Token expires ${new Date(channel.tokenExpiry).toLocaleString()}` : undefined}
                        variant={health.variant}
                      >
                        {health.label}
                      </Badge>
                    }
                    key={channel.id}
                    leading={
                      <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
                        <Plug className="size-4" />
                      </span>
                    }
                    meta={[
                      labelFor(channel.destination),
                      channel.credentialKind,
                      summary || "No additional connection details",
                    ]}
                    title={channel.name}
                  />
                );
              })}
            </ListRows>
          ) : null}
        </ListSurface>
      </div>

      {/* Disconnect confirmation */}
      <Dialog
        open={disconnectTarget !== null}
        onOpenChange={(open) => !open && setDisconnectTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect channel</DialogTitle>
            <DialogDescription>
              &ldquo;{disconnectTarget?.name}&rdquo; stops receiving publishes and scheduled posts
              to it will fail. Its tokens are not revoked on{" "}
              {disconnectTarget ? labelFor(disconnectTarget.destination) : "the platform"} — revoke
              access there if needed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDisconnectTarget(null)}
              disabled={disconnectLoading}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDisconnect} disabled={disconnectLoading}>
              {disconnectLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Disconnect channel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
