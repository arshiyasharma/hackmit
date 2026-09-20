"use client";

/**
 * Who is in the room, and the way out of it.
 *
 * The product's room screen has no chrome to spare — two readouts, a strip and
 * the ask — so everything that is about the visit rather than the room lives
 * behind one 40px chip: who you are, start over, sign out, back to the rooms.
 *
 * It says only what is known: the name, email and picture are Google's, through
 * lib/auth/session.ts, and a guest has none — the sheet says so instead of
 * making one up.
 */

import * as React from "react";
import { DoorOpen, LogOut, RotateCcw, UserRound } from "lucide-react";
import { toast } from "sonner";

import Sheet from "@/components/ui/Sheet";
import { displayName, initials, signOut, useSession } from "@/lib/auth/session";
import { useAppNav } from "@/lib/nav";
import { useStore } from "@/lib/store";

import type { Screen } from "./ProductRoom";

type Props = {
  screen: Screen;
  /** back through the paper to the landing's third room */
  onLeave: () => void;
};

export default function AccountChip({ screen, onLeave }: Props) {
  const session = useSession();
  const nav = useAppNav();
  const reset = useStore((s) => s.reset);
  const hasWork = useStore((s) => s.roomImage !== null || s.items.length > 0);
  const [open, setOpen] = React.useState(false);

  const letters = initials(session);
  const name = displayName(session);
  const guest = session?.provider === "guest";

  const startOver = () => {
    setOpen(false);
    reset();
    toast("Started over. Your doorway measurements were kept.");
    if (screen !== "capture") nav.push("/");
  };

  return (
    <>
      <button
        type="button"
        className="pixx-chip glass-pill"
        aria-label={`Account: ${name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {session?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a provider's avatar host is not known ahead of time
          <img src={session.avatarUrl} alt="" referrerPolicy="no-referrer" />
        ) : letters ? (
          letters
        ) : (
          <UserRound size={18} aria-hidden />
        )}
      </button>

      <Sheet open={open} onOpenChange={setOpen} snapPoints={[0.62]} initialSnap={0} label="Account">
        <div className="pixx-account">
          <div className="pixx-account-who">
            <span className="pixx-account-avatar" aria-hidden>
              {letters || <UserRound size={20} />}
            </span>
            <div>
              <p className="pixx-account-name">{name}</p>
              <p className="pixx-account-sub">
                {guest
                  ? "You are here as a guest. Nothing about you is stored."
                  : session?.name && session.email
                    ? session.email
                    : "Signed in with Google"}
              </p>
            </div>
          </div>

          {hasWork ? (
            <button type="button" className="pixx-account-row" onClick={startOver}>
              <RotateCcw size={20} aria-hidden />
              <span>
                Start over
                <small>A new photo and an empty room. Your doorways are kept.</small>
              </span>
            </button>
          ) : null}

          <button
            type="button"
            className="pixx-account-row"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
          >
            <LogOut size={20} aria-hidden />
            <span>{guest ? "Sign in instead" : "Sign out"}</span>
          </button>

          <button
            type="button"
            className="pixx-account-row"
            data-tone="leave"
            onClick={() => {
              setOpen(false);
              onLeave();
            }}
          >
            <DoorOpen size={20} aria-hidden />
            <span>
              Back to the rooms
              <small>Your room stays as you left it until you reload.</small>
            </span>
          </button>
        </div>
      </Sheet>
    </>
  );
}
