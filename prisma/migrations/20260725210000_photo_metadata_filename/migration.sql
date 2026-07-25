-- Tambah nilai enum "filename" untuk sumber waktu cap foto (jam dari nama file WhatsApp).
ALTER TYPE "PhotoMetadataSource" ADD VALUE IF NOT EXISTS 'filename';
