# Altar Screen

**Player-facing:** yes
**Status:** planned
**Started:** —

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
- **A non-spell offer is a SCROLL.** Stars, heals, rerolls, rank-ups and sacrifices
  are not pages and should not pretend to be. Same pixel-art hand, different object,
  so "this is a spell" and "this is not" is answered by shape before it is read.
- **The golden page is gold everywhere.** On the altar and in the book after it is
  claimed. It is a one-run gift and it should look like one for the whole run.

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

- The three offers are side by side and read as peers.
- A spell offer is visibly a page from the book; a non-spell offer is visibly a scroll.
- A golden page is gold on the altar and gold in the book for the rest of the run.
- All three columns are legible at 375px wide.
