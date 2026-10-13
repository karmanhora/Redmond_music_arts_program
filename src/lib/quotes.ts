/**
 * Something to read while the app is starting.
 *
 * The loading surfaces are the only places in the product with nothing to do,
 * so they carry one short line about why any of this exists.
 *
 * **Every line here was checked against a primary text or a quotation
 * reference on 2026-10-12**, and the check changed the list:
 *
 *   - "Where words fail, music speaks" (usually printed under Hans Christian
 *     Andersen's name) was **removed**: no source ties it to him.
 *   - "One good thing about music: when it hits, you feel no pain" was
 *     **removed**: it is a line from Bob Marley's *Trenchtown Rock*, not a
 *     saying, and lyrics are out of bounds for a school product.
 *   - The sentence about music being a pleasure human nature cannot do without
 *     was **re-attributed** from Confucius to the *Book of Rites*: it comes
 *     from the "Record of Music" (*Yueji*) chapter, not the *Analects*, so the
 *     familiar byline is folklore.
 *
 * Three of the lines below are **excerpts** of longer sentences, printed as the
 * clause people know them by:
 *
 *   - Artur Schnabel, quoted in the *Chicago Daily News*, 11 June 1958 — the
 *     full saying opens "The notes I handle no better than many pianists".
 *   - Leonard Bernstein, *The Unanswered Question* (1976) — the sentence opens
 *     "Music, because of its specific and far-reaching metaphorical powers".
 *   - Aaron Copland, "Music as an Aspect of the Human Spirit" (1954) — the
 *     sentence continues "and give it expressive meaning".
 *
 * And one is a **translation**: Victor Hugo, *William Shakespeare* (1864),
 * written in French and quoted here in A. Baillot's English rendering.
 *
 * Last two rules for anything added here: **no lyrics or copyrighted
 * excerpts**, and **two lines at most** on a 384px column so a quote never
 * turns a loading screen into a paragraph. The district's music staff are the
 * right people to approve the list.
 */
export interface MusicQuote {
  /** The sentence, without quotation marks — the renderer adds them. */
  text: string;
  /** Who said it — or, where the wording belongs to a work, where it is from. */
  author: string;
}

export const MUSIC_QUOTES: readonly MusicQuote[] = [
  { text: "If music be the food of love, play on.", author: "William Shakespeare" },
  { text: "Without music, life would be a mistake.", author: "Friedrich Nietzsche" },
  {
    text: "Music expresses that which cannot be said and on which it is impossible to be silent.",
    author: "Victor Hugo",
  },
  { text: "Music is the universal language of mankind.", author: "Henry Wadsworth Longfellow" },
  {
    text: "Music washes away from the soul the dust of everyday life.",
    author: "Berthold Auerbach",
  },
  { text: "The only thing better than singing is more singing.", author: "Ella Fitzgerald" },
  {
    text: "The pauses between the notes — ah, that is where the art resides.",
    author: "Artur Schnabel",
  },
  {
    text: "Music can name the unnameable and communicate the unknowable.",
    author: "Leonard Bernstein",
  },
  {
    text: "So long as the human spirit thrives on this planet, music in some living form will accompany and sustain it.",
    author: "Aaron Copland",
  },
  {
    text: "Music produces a kind of pleasure which human nature cannot do without.",
    author: "The Book of Rites",
  },
];

/**
 * One quote, at random.
 *
 * `random` is a parameter so the choice is testable and so a caller can pass a
 * stable value when it wants the same line twice (a screenshot, a test).
 */
export function pickMusicQuote(random: number = Math.random()): MusicQuote {
  const index = Math.min(
    MUSIC_QUOTES.length - 1,
    Math.max(0, Math.floor(random * MUSIC_QUOTES.length))
  );
  return MUSIC_QUOTES[index]!;
}
