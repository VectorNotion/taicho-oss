import { registerAdapter } from "../registry";
import { youtubeAdapter } from "./youtube";
import { xAdapter } from "./x";
import { linkedinAdapter } from "./linkedin";
import { instagramAdapter } from "./instagram";
import { cmsAdapter } from "./cms";
import { webhookAdapter } from "./webhook";

registerAdapter(youtubeAdapter);
registerAdapter(xAdapter);
registerAdapter(linkedinAdapter);
registerAdapter(instagramAdapter);
registerAdapter(cmsAdapter);
registerAdapter(webhookAdapter);
