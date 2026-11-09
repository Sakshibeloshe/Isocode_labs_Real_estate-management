// Structured UI cards attached to chat messages (rendered by the buyer chat, never free text)
export type SlotOption = { id: string; startsAt: string };

export type Card =
  | { type: "slots"; projectId: string; projectName: string; slots: SlotOption[] }
  | { type: "noSlots" }
  | {
      type: "hold";
      slotId: string;
      visitId: string | null; // null → buyer must give name + phone first
      startsAt: string;
      expiresAt: string | null;
      projectName: string;
      name: string | null;
      phone: string | null;
      state: "open" | "done" | "expired";
    }
  | {
      type: "confirmed";
      manageToken: string;
      startsAt: string;
      projectName: string;
      address: string;
      mapUrl: string;
      exec: string;
      rera: string;
    }
  | { type: "handoff"; exec: string }
  | { type: "contact"; reason: string; done?: boolean }
  | { type: "fallback"; done?: boolean };

export type ChatMessageDTO = {
  id: string;
  role: "BUYER" | "ASSISTANT" | "SYSTEM";
  content: string;
  card: Card | null;
  createdAt: string;
};
