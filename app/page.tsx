import Capture from "@/components/Capture";

/**
 * Capture is the whole screen: the live camera feed is the background, not a
 * widget in a card, so this route carries no AppShell chrome. Everything
 * interactive lives in the client component, which routes to /room the moment
 * the shutter fires.
 */
export default function Page() {
  return <Capture />;
}
