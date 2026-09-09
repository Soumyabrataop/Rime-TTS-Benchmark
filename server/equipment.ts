import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export type Equipment = {
  id: string;
  aliases: string[];
  error: string;
  description: string;
  firstCheck: string;
  secondCheck: string;
  safeToRestart: boolean;
};

export type LookupResult = {
  equipment: Equipment | null;
  answer: string;
  acknowledgement: string;
  intent: "diagnose" | "first_check" | "restart" | "unknown";
};

const fixtureUrl = new URL("../fixtures/equipment.json", import.meta.url);
const equipment: Equipment[] = JSON.parse(
  await readFile(fileURLToPath(fixtureUrl), "utf8"),
) as Equipment[];

function normalized(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getEquipmentForPrompt(prompt: string): Equipment | null {
  const value = normalized(prompt);
  return (
    equipment.find((item) =>
      item.aliases.some((alias) => value.includes(normalized(alias))),
    ) ?? null
  );
}

export function classifyIntent(prompt: string): LookupResult["intent"] {
  const value = normalized(prompt);
  if (/safe|restart|start again|run again/.test(value)) return "restart";
  if (/first|inspect|check first|what should/.test(value)) return "first_check";
  if (/wrong|error|issue|fault|diagnos|stopped|overload|pressure|intake/.test(value)) {
    return "diagnose";
  }
  return "unknown";
}

export function lookupEquipment(prompt: string): LookupResult {
  const equipmentItem = getEquipmentForPrompt(prompt);
  const intent = classifyIntent(prompt);

  if (!equipmentItem) {
    return {
      equipment: null,
      intent,
      acknowledgement: "I’m checking the equipment record now.",
      answer:
        "I couldn’t match that equipment ID. Try pump four, pump seven, or motor twelve.",
    };
  }

  const label = equipmentItem.id.replace("_", " ");
  const acknowledgement = `Checking ${label} now.`;

  if (intent === "first_check") {
    return {
      equipment: equipmentItem,
      intent,
      acknowledgement,
      answer: `For ${label}, start by ${equipmentItem.firstCheck.toLowerCase()}`,
    };
  }

  if (intent === "restart") {
    const recommendation = equipmentItem.safeToRestart
      ? "It is safe to restart after the first check."
      : `Do not restart it yet. ${equipmentItem.firstCheck}`;
    return { equipment: equipmentItem, intent, acknowledgement, answer: recommendation };
  }

  return {
    equipment: equipmentItem,
    intent,
    acknowledgement,
    answer: `${label} is reporting ${equipmentItem.error}, a ${equipmentItem.description.toLowerCase()}. First, ${equipmentItem.firstCheck.toLowerCase()}`,
  };
}

export function equipmentCount(): number {
  return equipment.length;
}
