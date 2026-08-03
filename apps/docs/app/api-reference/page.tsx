import type { Metadata } from "next";
import { ApiReference } from "@/components/api-reference";

export const metadata: Metadata = {
  title: "API reference",
  description:
    "Explore Taicho REST API operations, parameters, OAuth scopes, request bodies, and responses.",
};

export default function ApiReferencePage() {
  return <ApiReference />;
}
