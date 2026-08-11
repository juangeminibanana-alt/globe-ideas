# Bundled product worlds

This directory contains curated, portable Fast Track results that keep selected
product worlds available when the original local research drives are absent.

The server scans this directory in addition to configured local roots. Worlds
are grouped by product ID, so a bundled copy never creates a duplicate planet.
When a live Fast Track run exists, it remains the preferred source.

Set `PRODUCT_WORLD_LOCAL_SCAN=0` to run exclusively from these portable bundles.

Large raw renders, rejected QA candidates, logs, caches, and captured HTML are
excluded from bundles. Machine-specific filesystem paths are sanitized.
