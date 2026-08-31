import { closeDriver } from "@content-automation/platform/data/graph";
import { backfillAllLegacyMediaOwnership } from "../media/backfill";
import { closePublishingPools } from "../publishing/pool";

try {
  const { bases, posts, orphans } = await backfillAllLegacyMediaOwnership();
  console.log(`Backfilled Content Base ownership for ${posts} legacy Post(s) across ${bases} Content Base(s).`);
  if (orphans) {
    console.warn(`Preserved ${orphans} legacy media row(s) whose deleted Post has no Content Base mapping.`);
  }
} finally {
  await Promise.all([closePublishingPools(), closeDriver()]);
}
