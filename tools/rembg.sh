#!/usr/bin/env bash
# Fetch a proper alpha matte for every cached raw, into art/_work/raw/nobg/.
#
# Runs the generator's background remover over the raws that are ALREADY cached,
# so no art changes — same seed, same image, only the alpha channel is new. The
# local flood fill in genart.py can only reach background that touches the border,
# which left the inside of every enclosed shape opaque white: the telescope's
# tripod, the arch under the lectern, the meat rack's frame, the gap between a
# hound's legs and through its ribcage. See `matted()` in genart.py.
#
#   tools/rembg.sh ids.txt      # one asset id per line, trailing newline required
#
# Skips anything already fetched, so it is safe to re-run after a failure.
set -u
AC="$HOME/dev/loadout-library/skills/asset-creator/scripts"
mkdir -p art/_work/raw/nobg
export SCENARIO_API_KEY=$(op read "op://Secrets/Scenario/SCENARIO_API_KEY")
export SCENARIO_API_SECRET=$(op read "op://Secrets/Scenario/SCENARIO_API_SECRET")
while read -r id; do
  [ -z "$id" ] && continue
  if [ -f "art/_work/raw/nobg/$id.png" ]; then echo "  [have] $id"; continue; fi
  if uvx --from "$AC" asset-creator --remove-bg --reference "art/_work/raw/$id.png" \
      --output "art/_work/raw/nobg/$id.png" >/dev/null 2>&1; then echo "  [bg ] $id"
  else echo "  [FAIL] $id"; fi
done < "$1"
