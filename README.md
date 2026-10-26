# Mine Reserve Workbench 2.0

An improved, browser-local edition of the user's Mine Reserve application. Retains the original interactive canvas map, orthophoto, collar/assay inspection, GPS, sections, field points and GIS/CAD tools.

## Run and deploy

No build or API is required. Serve `dist/` with any static HTTP server. Production should use HTTPS for GPS, installation and service workers. Publish `dist/` using Cloudflare Pages. For GitHub Pages use the included workflow (Settings > Pages > GitHub Actions). The `.openai` file is for the private preview host only and is not required for those deployments.

## Included source data

Copied from https://mine-reserve.pages.dev/ on 2026-10-25, with the user's authorization:
- `remain_reserve_okt_hir0.csv`: 33,051 blocks.
- Four collar CSVs merged with the original deduplication rule: 2,834 collars.
- Three assay CSVs: 71,459 intervals under the retained parser.
- `ortho_all_new_preview.webp`: original georeferenced 6000 × 4589 display preview, with its metadata JSON. This is NOT the full-resolution source GeoTIFF.

See `dist/data/sources.json` for file dates. Only source data and application files are bundled, not Drive credentials. This snapshot never automatically requests the old application's API. Publish the data only to an audience authorized to view it; a public static host exposes bundled files.

## Fixed behavior

- Extent extends half a block beyond centres; boundary points are included.
- CSV rejects missing/invalid grades, invalid coordinates, nonpositive/missing density and duplicate XYZ records. Validation failure preserves the previous dataset.
- Polygon-only totals and slope-envelope totals are explicitly distinguished; their exports retain separate scope.
- The latest valid block dataset is saved in IndexedDB. Bundled ortho, collars, assays and application assets are precached. Local polygon settings use localStorage; portable JSON export/import is available.
- Data / Design / Results / Field workspace tabs, direct map drawing controls, smaller collar markers and zoom-dependent labels.

## Model assumptions and limitations

Grid is fixed at 12.5 × 12.5 × 1 m; all imported coordinates must be EPSG:32751. Coordinates are block centres. Volume is full-block centre inclusion, not clipped volume. Density is t/m³, Ni/Fe are percent. Grades are tonnage-weighted. Ni 1.20% cutoff groups are operational above/below-cutoff groups, NOT geological saprolite identification. Original source classification_no=1 maps to OB/Waste, as in the existing app; this is not corrected by guessing the meaning of material_class=0.

Depth is relative to each XY column's highest available Z. The 60° envelope is a planning approximation, not a geotechnical pit design. Imported grids with different dimensions require changing and testing the model constants first. Plan/section/GIS/GPS features are retained but not all field-validated. GeoTIFF and SHP/projection import dynamically load external libraries and may require internet on first use. No shared backend, user accounts, or Drive synchronization is included.

Browser data can be lost if site storage is cleared or evicted. Export important designs. Imported custom orthophotos are session-specific; use the provided conversion exports to retain them. Do not present local storage as a central multi-user backup.

## Verification

`node tests/core.test.cjs`

Tests exercise the actual imported parser and geometry helpers, invalid input rejection, boundary inclusion, self-crossing polygons, and independent full-model totals. Verified snapshot: 33,051 blocks; 5,164,218.75 m³; 8,687,781.25 t. Stage 1: 2,579 blocks. Browser checks cover map loading, full extent, workspace tabs and reload.

## Future Drive integration

Add an authenticated backend endpoint that retrieves an explicitly selected dataset and produces a complete versioned snapshot. Keep service-account/OAuth secrets on the server. Validate before replacing the local snapshot. Do not copy old frontend calls to `/api/drive` without supplying that backend.
