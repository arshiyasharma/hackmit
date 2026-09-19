import { countSignups } from "@/lib/waitlist-db";
import RoomScene from "./RoomScene";
import WaitlistScreen from "./WaitlistScreen";

export const dynamic = "force-dynamic";

export default async function WaitlistPage() {
  // The count is decorative — a broken count should never take the landing page
  // down mid-demo, but it should scream in the server log.
  let total: number | null = null;
  try {
    total = await countSignups();
  } catch (error) {
    console.error("[waitlist] could not read the signup count:", error);
  }

  return (
    <div className="wl-root">
      <div className="wl-glow wl-glow-a" aria-hidden />
      <div className="wl-glow wl-glow-b" aria-hidden />
      <div className="wl-grain" aria-hidden />

      <div className="wl-sketch" aria-hidden>
        <RoomScene />
      </div>

      <header className="wl-head">
        <p className="wl-mark">
          cove<span aria-hidden />
        </p>
        <p className="wl-head-note">built at hackmit</p>
      </header>

      <WaitlistScreen initialTotal={total} />
    </div>
  );
}
