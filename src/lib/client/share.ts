/**
 * ---------------------------------------------------------------------------
 * SHARING (browser adapter)
 * ---------------------------------------------------------------------------
 * One question: does this browser have a share sheet, and did the person use
 * it?
 *
 * Not a service. There is no endpoint, no image generation and no third party
 * — the text arrives already built by `shareTextOf`, and this file's whole job
 * is to hand it to `navigator.share` when that exists and to the clipboard
 * when it does not. It is separated from the component only because the
 * branching is worth testing without mounting React.
 *
 * The awkward part of the Web Share API is that a cancelled share and a broken
 * share look almost identical: both reject. They must not be treated alike —
 * telling someone "share failed" because they closed the sheet is worse than
 * saying nothing — so a cancellation is reported as its own outcome and the
 * caller stays quiet about it.
 */

export type ShareOutcome =
  /** The native sheet accepted it. */
  | "shared"
  /** No sheet here; the text went to the clipboard instead. */
  | "copied"
  /** The person dismissed the sheet. Not an error; say nothing. */
  | "cancelled"
  /** Neither route worked. */
  | "failed";

/** The slice of `navigator` this needs, so a test can supply its own. */
export interface ShareTarget {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
}

/**
 * Shares through the native sheet, or copies as a fallback.
 *
 * The URL is passed to `navigator.share` as its own field rather than only
 * being glued onto the end of the text: share targets that understand a link
 * — messaging apps, mail — render it as a link that way, and the ones that do
 * not still receive it in the text.
 */
export async function shareOrCopy(
  target: ShareTarget | undefined,
  content: { title?: string; text: string; url?: string | null },
): Promise<ShareOutcome> {
  const url = content.url || undefined;

  if (target?.share) {
    try {
      await target.share({ title: content.title, text: content.text, url });
      return "shared";
    } catch (err) {
      // A dismissed sheet rejects with AbortError. That is a decision, not a
      // fault, and it must not fall through to the clipboard — copying
      // something the person just declined to send is its own small betrayal.
      if (isAbort(err)) return "cancelled";
      // Anything else: the sheet is unusable here, so try the clipboard.
    }
  }

  if (target?.clipboard?.writeText) {
    try {
      // The text carries the URL already, so a paste is complete on its own.
      await target.clipboard.writeText(content.text);
      return "copied";
    } catch {
      return "failed";
    }
  }

  return "failed";
}

function isAbort(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name?: unknown }).name === "AbortError"
  );
}
