# GH_TOKEN Yolo Wrapper Fix

**Agents:** Brand  
**Timestamp:** 2026-04-17T22:43:59Z

## Summary

Brand updated `scripts/copilot-yolo.sh` to forward GH_TOKEN conditionally when set, while preserving SSH agent socket forwarding. No new issues. Commit: 870006c.

## What Was Done

1. Modified yolo wrapper to check if GH_TOKEN exists before forwarding
2. Updated help text and dry-run output
3. Tested and committed

## Status

✅ Complete. Ready for use.
