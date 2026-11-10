-- Item kontrak yang volumenya dinolkan di draft bisa dipasangkan ke item baru
-- (DECISIONS 756). Kunci asli baris bervolume 0 yang menyerahkan kuncinya.
ALTER TABLE "rab_nodes" ADD COLUMN IF NOT EXISTS "lineage_tergeser" TEXT;
