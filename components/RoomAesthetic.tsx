"use client";

import { LoaderCircle, Pencil, Sparkles } from "lucide-react";
import { useRoomContext, useStore } from "@/lib/store";

/** The photo's aesthetic stays visible while the user designs their room. */
export default function RoomAesthetic({ onEdit }: { onEdit: () => void }) {
  const context = useRoomContext();
  const room = useStore((state) => state.roomImage);
  const edits = useStore((state) => state.edits);
  const reading = !!room && !context;
  const palette = context ? [...new Set([...(context.picked ?? []), ...context.palette])] : [];
  const customized = Object.values(edits).some((values) => values.length > 0);
  const status = reading
    ? "Finding the colours and style in your photo…"
    : !context ? "Upload your room to discover its style."
      : context.source === "fallback" ? "We couldn’t read the photo. Add your colours and style."
        : customized ? "Your edits are saved for this room’s next searches."
          : "Extracted from your photo · used in every new search.";

  return (
    <section className="room-aesthetic" aria-labelledby="room-aesthetic-title" aria-busy={reading}>
      <div className="room-aesthetic-heading">
        <div className="room-aesthetic-title-row">
          {reading ? <LoaderCircle size={16} className="room-aesthetic-loading" aria-hidden /> : <Sparkles size={16} aria-hidden />}
          <h2 id="room-aesthetic-title">Your aesthetic</h2>
        </div>
        <p role="status">{status}</p>
      </div>
      {context ? (
        <div className="room-aesthetic-preview" aria-label="Current colours and keywords">
          <div className="room-aesthetic-swatches">
            {palette.slice(0, 5).map((hex) => <span key={hex} style={{ backgroundColor: hex }} title={hex} aria-label={`Colour ${hex}`} />)}
          </div>
          <p title={context.styleTags.join(" · ")}>{context.styleTags.slice(-3).join(" · ") || "Add your style words"}</p>
        </div>
      ) : reading ? <div className="room-aesthetic-skeleton" aria-hidden><i /><i /><i /></div> : null}
      <button type="button" onClick={onEdit} className="room-aesthetic-edit" aria-label="Edit your aesthetic">
        <Pencil size={14} aria-hidden /><span>Edit aesthetic</span>
      </button>
    </section>
  );
}
