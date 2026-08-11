# Altar Screen

**Player-facing:** yes
**Status:** shipped
**Started:** 2026-08-10

The altar's three offers, as objects you are choosing between rather than rows in a
list.

## Why this phase

The altar is the only place in the run where the player makes a lasting choice, and it
is presented as a settings menu: three stacked rows of text with a coloured left edge.
Everything else in this game is a physical object — pages are torn, cards are held,
stone is drawn a texel at a time — and then the one moment that matters is a list.

A vertical list also reads as a ranking. Three things side by side read as a choice.

The golden page is the sharpest version of the problem: it is the rarest thing the
altar offers, it is described as gilded, and it is drawn as a row with amber text.
Then it arrives in the book looking like every other page.

## Settled decisions

- **Three columns, left to right.** Not a list. The choice is between peers.
- **A spell offer IS a spell-book page.** The same art the grimoire draws, at card
  size — the player already knows what that object is and what it does, so the offer
  needs no explaining.
- **A non-spell offer is a SCROLL.** Stars, heals, rank-ups and sacrifices are not
  pages and should not pretend to be. Same pixel-art hand, different object, so "this
  is a spell" and "this is not" is answered by shape before it is read. A `star`
  payout is a scroll too, though it carries the id of the page it was rolled for —
  the kind decides the object, never the presence of an id.
- **A page prints the name it carries AT THAT RANK.** A rank-2 fire page is a
  Fireball and the sheet says Fireball, on the altar card and in the grimoire alike.
  The art was authored once off the rank-1 name, so an upgrade offer was a card headed
  "Flame" under a caption reading "Fireball" — the object contradicting the sentence
  describing it, and reading as a second copy of a page already held.
- **The golden page is gold everywhere, on the run that WINS it.** On the altar, and
  in the book from the moment it is claimed until that descent ends. The gift it
  leaves is a different thing and carries no gold: the next run begins holding the
  page as an ordinary sheet. Gilding the gift instead put the mark on the descent
  that had not earned it and showed nothing at all to the descent that had.

## Out of scope

- What the altar offers or how the roll is weighted, which is Altar_Reward_Node.
- The star tree screen.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading.

**The page art already exists.** `pageArt` in `pageTexture.ts` draws a spell's page
into a `Pix`; the offer card is that, at card scale, on a portrait quad. The work is
layout and a scroll, not a new art pipeline.

**The gold variant is the real work.** It is a recolour of the page face — parchment
to gilt, ink to a darker brown, the rule and border to gold leaf — applied at the
point the page is drawn rather than as a second texture, so it survives every rank and
every spell without doubling the atlas.

**Portrait, three across, on a 375px screen.** Each column is about 110px wide. That
is narrow for a page and it is the constraint the layout has to answer; a legible
column of two is a better outcome than three illegible ones, so measure before
committing to three.

## Acceptance

- The three offers are side by side and read as peers. — **met.**
- A spell offer is visibly a page from the book; a non-spell offer is visibly a
  scroll. — **met.** The spell offer is not *like* a page, it IS one: `actionPage`,
  the same call the grimoire makes, seeded with the same book index so the sheet
  offered and the sheet torn are the same down to the foxing.
- A golden page is gold on the altar and gold in the book for the rest of the run. —
  **met.** `giltify` tone-maps the finished face onto a gilt ramp, and `setGilded`
  applies it to the run's gifted page so the book draws it gilded too.
- All three columns are legible at 375px wide. — **met**, with the card sized to the
  column rather than the column to the card.

## What the first attempt got wrong

Worth keeping, because it is the mistake this phase is *about*.

The first version authored a small lookalike — a sigil in a ring on a parchment
rectangle at 56×74, drawn at 2× so the texels stayed square. The reasoning was that
the book page is 128 texels wide, three columns on a 375px screen are about 110, and
scaling pixel art fractionally shimmers.

It was wrong, and Kalvin said so in five words: the pages are too small and look
nothing like the actual pages. The settled decision above says a spell offer IS a
spell-book page, and the whole argument for that is that the player already knows
what the object is. A card that merely RESEMBLES a page has to be learnt from
scratch, and looks like a worse version of something already familiar. Protecting
integer scaling at the cost of the object's identity traded the wrong thing away.

The fix was to call `actionPage` directly and let the layout size the card to
whatever the column can give it. The fractional scale is invisible; the book draws
these same pages on a 3D quad at an arbitrary size already.
