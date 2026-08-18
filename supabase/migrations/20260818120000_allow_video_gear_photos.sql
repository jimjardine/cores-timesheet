-- Techs can now attach video (gear diagnostics, a vibration/sound that's
-- easier to show than describe) alongside photos. Video files run much
-- bigger than photos, so the per-file cap goes from 15MB to 100MB too.
UPDATE storage.buckets
SET file_size_limit = 104857600,
    allowed_mime_types = array_cat(
      allowed_mime_types,
      ARRAY['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp']
    )
WHERE id = 'gear-photos';
