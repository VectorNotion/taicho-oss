"use client";

import { createAuthClient } from "better-auth/react";
import { genericOAuthClient, organizationClient } from "better-auth/client/plugins";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { ac, roles } from "./permissions";

export const authClient = createAuthClient({
  plugins: [
    organizationClient({ ac, roles, teams: { enabled: true } }),
    oauthProviderClient(),
    genericOAuthClient(),
  ],
});
