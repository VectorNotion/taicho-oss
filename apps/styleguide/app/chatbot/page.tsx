import type { Metadata } from "next";
import { ChatbotSpecSheet } from "@/apps/chatbot-spec/components/ChatbotSpecSheet";

export const metadata: Metadata = {
  title: "Vector Notion · Chatbot register",
  description: "The expressive register reference — the interactive chatbot spec, mounted in the styleguide",
};

export default function ChatbotPage() {
  return <ChatbotSpecSheet />;
}
